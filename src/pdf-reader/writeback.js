import { CANVAS_HIGHLIGHT_COLORS } from "../constants.js";
import { Notice, normalizePath } from "obsidian";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "../../vendor/pdf-lib.min.js";
import { bytesContainAscii } from "../binary-utils.js";

const writebackMethods = {
  async readPdfBinary(file) {
    const permissionDenied = (error) => ["EPERM", "EACCES"].includes(error?.code)
      || /\b(?:EPERM|EACCES)\b/.test(String(error?.message || ""));
    let lastError = null;
    // 安全软件扫描新文件时可能短暂锁住文件，先做几次短重试
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.app.vault.readBinary(file);
      } catch (error) {
        if (!permissionDenied(error)) throw error;
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    if (typeof this.app.vault.getResourcePath === "function" && typeof globalThis.fetch === "function") {
      // Obsidian 的 resource URL 走应用自己的读取通道，direct fs 被安全软件拒绝时仍可能可读
      try {
        const resourcePath = this.app.vault.getResourcePath(file);
        if (!resourcePath) throw new Error("PDF 资源地址为空");
        const response = await globalThis.fetch(resourcePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.arrayBuffer();
      } catch (resourceError) {
        throw new Error(
          `读取 PDF 被系统拒绝（${lastError?.message || lastError}）；Obsidian 资源读取也失败：${resourceError.message || resourceError}。如果文件被安全软件标记，请稍后重试或联系管理员。`,
          { cause: lastError }
        );
      }
    }
    throw lastError;
  },

  isInkMark(mark) {
    if (!mark) return false;
    if (mark.pdfSubtype === "Ink" || mark.type === "ink") return true;
    return ["line", "arrow", "circle", "ellipse", "rect"].includes(mark.type);
  },

  getPdfInkPaths(mark, pageSize) {
    const width = Math.max(1.5, Math.min(8, Number(mark?.width) || 3));
    const pageWidth = Math.max(1, Number(pageSize?.width) || 612);
    const pageHeight = Math.max(1, Number(pageSize?.height) || 792);
    const toPdf = (point) => ({
      x: Math.max(0, Math.min(1, Number(point?.x) || 0)) * pageWidth,
      y: (1 - Math.max(0, Math.min(1, Number(point?.y) || 0))) * pageHeight
    });
    const pathFromPoints = (points) => {
      const path = [];
      (points || []).forEach((point) => {
        const value = toPdf(point);
        path.push(value.x, value.y);
      });
      if (path.length === 2) path.push(path[0], path[1]);
      return path;
    };
    if (mark.type === "ink") {
      const path = pathFromPoints(mark.points);
      return path.length >= 4 ? [path] : [];
    }
    const start = toPdf(mark.start);
    const end = toPdf(mark.end);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) return [];
    if (mark.type === "line") {
      return [[start.x, start.y, end.x, end.y]];
    }
    if (mark.type === "arrow") {
      const ux = dx / length;
      const uy = dy / length;
      const size = Math.max(10, width * 4);
      const half = size * 0.45;
      const baseX = end.x - ux * size;
      const baseY = end.y - uy * size;
      return [
        [start.x, start.y, baseX, baseY],
        [end.x, end.y, baseX - uy * half, baseY + ux * half],
        [end.x, end.y, baseX + uy * half, baseY - ux * half]
      ];
    }
    if (mark.type === "rect") {
      return [[start.x, start.y, end.x, start.y, end.x, end.y, start.x, end.y, start.x, start.y]];
    }
    // 圆/椭圆：用闭合折线近似
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    if (radiusX < 0.5 || radiusY < 0.5) return [];
    const path = [];
    const steps = 48;
    for (let index = 0; index <= steps; index += 1) {
      const angle = (Math.PI * 2 * index) / steps;
      path.push(centerX + radiusX * Math.cos(angle), centerY + radiusY * Math.sin(angle));
    }
    return [path];
  },

  writeLocalPdfInkAnnotation(document, mark) {
    if (!this.isInkMark(mark)) return false;
    const page = document.getPage(Math.max(0, Number(mark.page || 1) - 1));
    if (!page) throw new Error("PDF 页码不存在");
    const pageSize = page.getSize?.() || { width: 612, height: 792 };
    const paths = this.getPdfInkPaths(mark, pageSize);
    if (!paths.length) return false;
    const annotationId = `paperlib:${mark.pdfAnnotationId || mark.id}`;
    const annotsName = PDFName.of("Annots");
    let annots = page.node.lookupMaybe(annotsName, PDFArray);
    if (!annots) {
      annots = document.context.obj([]);
      page.node.set(annotsName, annots);
    }
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
      if (!dictionary) continue;
      if (this.readPdfAnnotationString(document, dictionary, "NM") === annotationId) annots.remove(index);
    }
    const xs = [];
    const ys = [];
    paths.forEach((path) => {
      for (let index = 0; index + 1 < path.length; index += 2) {
        xs.push(path[index]);
        ys.push(path[index + 1]);
      }
    });
    if (!xs.length) return false;
    const width = Math.max(1.5, Math.min(8, Number(mark.width) || 3));
    const pad = Math.max(2, width);
    const rect = [
      Math.min(...xs) - pad,
      Math.min(...ys) - pad,
      Math.max(...xs) + pad,
      Math.max(...ys) + pad
    ];
    const values = {
      Type: "Annot",
      Subtype: "Ink",
      Rect: rect,
      C: this.pdfColor(mark.color),
      CA: 1,
      F: 4,
      P: page.ref,
      Border: [0, 0, width],
      BS: { W: width, S: "S" }
    };
    const annotation = document.context.obj(values);
    annotation.set(PDFName.of("T"), PDFHexString.fromText("Paper Library"));
    annotation.set(PDFName.of("Contents"), PDFHexString.fromText(
      mark.type === "ink" ? "Paper Library ink" : `Paper Library shape (${mark.type})`
    ));
    annotation.set(PDFName.of("NM"), PDFHexString.fromText(annotationId));
    annotation.set(PDFName.of("M"), PDFString.of(this.pdfDate()));
    annotation.set(PDFName.of("InkList"), document.context.obj(paths));
    annots.push(document.context.register(annotation));
    return true;
  },

  pdfColor(colorId) {
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === String(colorId || "").toLocaleLowerCase())
      || CANVAS_HIGHLIGHT_COLORS[0];
    const value = color.value.replace("#", "");
    return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  },

  pdfDate(date = new Date()) {
    return `D:${date.toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;
  },

  async backupLocalPdfBeforeMutation(file, sourceBytes) {
    // 每个 PDF 在本次会话第一次写回前留一份原始副本，避免写回异常时无法回退
    if (!file?.path || !sourceBytes) return false;
    const path = normalizePath(file.path);
    this.pdfBackupSessions = this.pdfBackupSessions || new Set();
    if (this.pdfBackupSessions.has(path)) return false;
    const adapter = this.app?.vault?.adapter;
    if (!adapter?.writeBinary) return false;
    try {
      const directory = this.getPluginVaultPath("pdf-backups");
      if (adapter.exists && !(await adapter.exists(directory))) {
        await adapter.mkdir?.(directory);
      }
      let hash = 0;
      for (let index = 0; index < path.length; index += 1) {
        hash = ((hash << 5) - hash + path.charCodeAt(index)) | 0;
      }
      const base = String(file.basename || "document").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "document";
      const target = normalizePath(`${directory}/${base}-${Math.abs(hash).toString(36)}.pdf`);
      const buffer = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
      await adapter.writeBinary(target, buffer);
      this.pdfBackupSessions.add(path);
      return true;
    } catch (error) {
      console.warn("Paper Library: failed to back up PDF before annotation writeback", error);
      return false;
    }
  },

  async mutateLocalPdf(pdfPath, mutate) {
    const path = normalizePath(pdfPath || "");
    if (!path || /^https?:\/\//i.test(path) || !this.app.vault?.modifyBinary) return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("找不到本地 PDF 文件");
    const previous = this.pdfMutationQueues.get(path) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const source = await this.readPdfBinary(file);
      const sourceBytes = new Uint8Array(source);
      if (bytesContainAscii(sourceBytes, "/ByteRange") || bytesContainAscii(sourceBytes, "/Type/Sig")
        || bytesContainAscii(sourceBytes, "/Type /Sig")) {
        throw new Error("该 PDF 含数字签名，写入批注会使签名失效，已保留插件内批注但未修改原文件");
      }
      const document = await PDFDocument.load(source, { updateMetadata: false });
      const changed = await mutate(document);
      if (!changed) return false;
      const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
      if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("PDF 序列化失败");
      const output = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await this.backupLocalPdfBeforeMutation(file, sourceBytes);
      await this.app.vault.modifyBinary(file, output);
      return true;
    });
    this.pdfMutationQueues.set(path, current);
    try {
      return await current;
    } finally {
      if (this.pdfMutationQueues.get(path) === current) this.pdfMutationQueues.delete(path);
    }
  },

  async upsertLocalPdfAnnotation(mark) {
    if (!mark?.pdfPath) return false;
    if (mark.pdfSubtype === "FreeText" && !String(mark.comment || mark.text || "").trim()) return true;
    if (mark.pdfSubtype !== "FreeText"
      && !this.isInkMark(mark)
      && (!Array.isArray(mark.pdfRects) || !mark.pdfRects.length)) return false;
    return this.mutateLocalPdf(mark.pdfPath, async (document) => this.writeLocalPdfAnnotation(document, mark));
  },

  readPdfAnnotationString(document, dictionary, name) {
    const raw = dictionary?.get?.(PDFName.of(name));
    if (!raw) return "";
    const direct = document.context.lookupMaybe(raw, PDFString, PDFHexString);
    if (direct) return direct.decodeText?.() || direct.asString?.() || "";
    // 兼容旧版本 context.obj 把 PDFString 包成 << /value ... >> 的坏数据
    const wrapper = document.context.lookupMaybe(raw, PDFDict);
    const nested = document.context.lookupMaybe(wrapper?.get?.(PDFName.of("value")), PDFString, PDFHexString);
    return nested?.decodeText?.() || nested?.asString?.() || "";
  },

  writeLocalPdfAnnotation(document, mark) {
    if (this.isInkMark(mark)) return this.writeLocalPdfInkAnnotation(document, mark);
    if (mark?.pdfSubtype === "FreeText" && !String(mark.comment || mark.text || "").trim()) return false;
    {
      const page = document.getPage(Math.max(0, Number(mark.page || 1) - 1));
      if (!page) throw new Error("PDF 页码不存在");
      const annotationId = `paperlib:${mark.pdfAnnotationId || mark.id}`;
      const annotsName = PDFName.of("Annots");
      let annots = page.node.lookupMaybe(annotsName, PDFArray);
      if (!annots) {
        annots = document.context.obj([]);
        page.node.set(annotsName, annots);
      }
      for (let index = annots.size() - 1; index >= 0; index -= 1) {
        const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
        if (!dictionary) continue;
        const value = this.readPdfAnnotationString(document, dictionary, "NM");
        if (value === annotationId) annots.remove(index);
      }
      const subtype = mark.pdfSubtype === "Text" ? "Text"
        : mark.pdfSubtype === "Underline" ? "Underline"
          : mark.pdfSubtype === "FreeText" ? "FreeText" : "Highlight";
      const color = this.pdfColor(mark.color);
      let rect;
      if (subtype === "FreeText") {
        // 自由文本框：位置来自页面相对坐标，换算成 PDF 点
        const size = page.getSize?.() || { width: 612, height: 792 };
        const box = mark.box || { x: 0.6, y: 0.3, width: 0.32 };
        const layout = this.measurePdfTextBoxText(mark, size);
        const width = layout.width;
        const x = Math.max(0, Math.min(size.width - width, layout.x));
        const yTop = (1 - Math.max(0, Math.min(1, Number(box.y) || 0.3))) * size.height;
        rect = [x, Math.max(0, yTop - layout.height), Math.min(size.width, x + width), yTop];
      } else {
        const allRects = (mark.pdfRects || []).map((item) => item.rect).filter((item) => item?.length === 4);
        rect = [
          Math.min(...allRects.map((item) => item[0])),
          Math.min(...allRects.map((item) => item[1])),
          Math.max(...allRects.map((item) => item[2])),
          Math.max(...allRects.map((item) => item[3]))
        ];
      }
      const values = {
        Type: "Annot",
        Subtype: subtype,
        Rect: subtype === "Text" ? [rect[2], Math.max(rect[1], rect[3] - 18), rect[2] + 18, rect[3]] : rect,
        C: color,
        CA: subtype === "FreeText" ? 1 : 0.38,
        F: 4,
        P: page.ref
      };
      if (subtype === "FreeText") {
        values.Border = [0, 0, 1];
      }
      if (subtype === "Highlight") {
        // 写入前合并重叠/相邻矩形：Obsidian 渲染注释时逐个四边形填充，
        // 原始选区矩形大量重叠（同一行拆成多段、上下差 1px），重叠处会被填充两次导致颜色不均。
        // 一行只写一个四边形（QuadPoints 顺序：左上、右上、左下、右下）。
        const mergedRects = this.mergePdfHighlightViewportRects(
          mark.pdfRects.map((item) => item.rect).filter((rect) => Array.isArray(rect) && rect.length === 4)
        );
        // 数学排版（分数、上下标）的文字层矩形常出现又窄又高的离群块，
        // 合并后表现为竖直窄条。按宽度加权的中位行高裁剪这类块，底部对齐基线。
        if (mergedRects.length > 1) {
          const widths = mergedRects.map((rect) => Math.max(0, rect[2] - rect[0]));
          const totalWidth = widths.reduce((sum, width) => sum + width, 0) || 1;
          const weighted = mergedRects
            .map((rect, index) => ({ height: Math.max(0, rect[3] - rect[1]), weight: widths[index] }))
            .sort((first, second) => first.height - second.height);
          let accumulated = 0;
          let medianHeight = weighted[weighted.length - 1]?.height || 0;
          for (const item of weighted) {
            accumulated += item.weight;
            if (accumulated >= totalWidth / 2) { medianHeight = item.height; break; }
          }
          if (medianHeight > 0) {
            mergedRects.forEach((rect, index) => {
              const width = widths[index];
              const height = Math.max(0, rect[3] - rect[1]);
              if (height > medianHeight * 1.8 && width < medianHeight * 2) {
                rect[1] = Math.max(rect[1], rect[3] - medianHeight * 1.2);
              }
            });
          }
        }
        values.QuadPoints = mergedRects.flatMap((rect) => [
          Math.min(rect[0], rect[2]), Math.max(rect[1], rect[3]),
          Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3]),
          Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]),
          Math.max(rect[0], rect[2]), Math.min(rect[1], rect[3])
        ]);
      }
      else values.Name = "Comment";
      const annotation = document.context.obj(values);
      // context.obj 会把 PDFString/PDFHexString 再包一层 { value }，必须用 set 直接写入字符串对象
      annotation.set(PDFName.of("T"), PDFHexString.fromText("Paper Library"));
      annotation.set(PDFName.of("Contents"), PDFHexString.fromText(mark.comment || mark.text || "Paper Library annotation"));
      annotation.set(PDFName.of("NM"), PDFHexString.fromText(annotationId));
      annotation.set(PDFName.of("M"), PDFString.of(this.pdfDate()));
      if (subtype === "FreeText") {
        annotation.set(PDFName.of("DA"), PDFString.of(
          `/Helvetica ${this.getPdfTextBoxFontSize(mark)} Tf ${this.pdfTextColorOperator(mark)}`
        ));
      }
      annots.push(document.context.register(annotation));
      return true;
    }
  },

  async removeLocalPdfAnnotations(marks) {
    // 删除时同步清理待写队列：on-leave 模式下标注可能还在队列里，
    // 不清掉的话 flush 会把已删除的标注重新写回 PDF
    (marks || []).forEach((mark) => {
      if (!mark?.pdfPath) return;
      const path = normalizePath(mark.pdfPath);
      for (const [key, pending] of this.pendingPdfAnnotationSyncs) {
        if (!key.startsWith(`${path}|`)) continue;
        if (pending?.id === mark.id
          || (mark.pdfAnnotationId && pending?.pdfAnnotationId === mark.pdfAnnotationId)) {
          this.pendingPdfAnnotationSyncs.delete(key);
        }
      }
    });
    const grouped = new Map();
    (marks || []).forEach((mark) => {
      if (!mark?.pdfPath || (!mark.pdfAnnotationId && !mark.id)) return;
      const path = normalizePath(mark.pdfPath);
      if (!grouped.has(path)) grouped.set(path, new Set());
      grouped.get(path).add(`paperlib:${mark.pdfAnnotationId || mark.id}`);
    });
    for (const [path, ids] of grouped) {
      await this.mutateLocalPdf(path, async (document) => {
        let changed = false;
        document.getPages().forEach((page) => {
          const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
          if (!annots) return;
          for (let index = annots.size() - 1; index >= 0; index -= 1) {
            const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
            if (!dictionary) continue;
            const value = this.readPdfAnnotationString(document, dictionary, "NM");
            if (!ids.has(value)) continue;
            annots.remove(index);
            changed = true;
          }
        });
        return changed;
      });
    }
  },

  async syncLocalPdfAnnotation(mark) {
    // 空文本框不写回：否则 PDF 阅读器只能显示 /Contents 的兜底文字
    if (mark?.pdfSubtype === "FreeText" && !String(mark.comment || "").trim()) return true;
    const mode = ["on-leave", "immediate", "off"].includes(this.settings.pdfAnnotationWriteback)
      ? this.settings.pdfAnnotationWriteback
      : "on-leave";
    if (mode === "off") return true;
    // on-leave：写回 PDF 会让 Obsidian 原生视图重载（闪烁），所以先排队，
    // 等离开该 PDF 视图 / 插件卸载 / 手动命令时再批量写入。
    // 批注本体已即时持久化到论文库与笔记，这里只影响外部阅读器可见的副本。
    if (mode === "on-leave") {
      if (mark?.pdfPath && (mark.pdfAnnotationId || mark.id)) {
        this.pendingPdfAnnotationSyncs.set(`${mark.pdfPath}|${mark.pdfAnnotationId || mark.id}`, mark);
      }
      return true;
    }
    try {
      return await this.upsertLocalPdfAnnotation(mark);
    } catch (error) {
      console.error("Paper Library: failed to write local PDF annotation", error);
      new Notice(`批注已保存到论文笔记，但写入 PDF 失败：${error.message || error}`);
      return false;
    }
  },

  async flushPdfAnnotationSyncs(filter = null, notify = false) {
    const entries = [...this.pendingPdfAnnotationSyncs.entries()]
      .filter(([, mark]) => !filter || filter(mark));
    if (!entries.length) {
      if (notify) new Notice("没有待写回的 PDF 批注");
      return;
    }
    entries.forEach(([key]) => this.pendingPdfAnnotationSyncs.delete(key));
    this.pdfAnnotationSyncFailures = this.pdfAnnotationSyncFailures || new Set();
    const groups = new Map();
    for (const [key, mark] of entries) {
      const path = normalizePath(mark.pdfPath || "");
      if (!path) continue;
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path).push({ key, mark });
    }
    let written = 0;
    const failEntry = (key, mark, error) => {
      this.pendingPdfAnnotationSyncs.set(key, mark);
      console.error("Paper Library: failed to write local PDF annotation", error);
      if (!this.pdfAnnotationSyncFailures.has(key)) {
        this.pdfAnnotationSyncFailures.add(key);
        new Notice(`批注已保存到论文笔记，但写入 PDF 失败：${error.message || error}`);
      }
    };
    for (const [path, list] of groups) {
      const failed = new Set();
      let batchWritten = 0;
      try {
        await this.mutateLocalPdf(path, async (document) => {
          let changed = false;
          for (const { key, mark } of list) {
            try {
              if (this.writeLocalPdfAnnotation(document, mark)) {
                changed = true;
                batchWritten += 1;
              }
            } catch (error) {
              failed.add(key);
              console.error("Paper Library: failed to write one PDF annotation", error);
            }
          }
          return changed;
        });
      } catch (error) {
        for (const { key, mark } of list) {
          if (!failed.has(key)) failed.add(key);
          failEntry(key, mark, error);
        }
        continue;
      }
      written += batchWritten;
      for (const { key, mark } of list) {
        if (failed.has(key)) failEntry(key, mark, new Error("写入失败"));
        else this.pdfAnnotationSyncFailures.delete(key);
      }
    }
    const paths = new Set(entries.map(([, mark]) => normalizePath(mark.pdfPath || "")).filter(Boolean));
    for (const path of paths) {
      try {
        await this.pruneLocalPdfAnnotations(path);
      } catch (error) {
        console.error("Paper Library: failed to prune stale PDF annotations", error);
      }
    }
    if (notify) new Notice(written ? `已写回 ${written} 条批注到 PDF 文件` : "没有待写回的 PDF 批注");
  },

  async pruneLocalPdfAnnotations(pdfPath) {
    // 删除 PDF 中属于本插件但已不在论文库里的注释（例如旧版本删除遗留的孤儿注释）
    const path = normalizePath(pdfPath || "");
    if (!path) return false;
    const paper = this.settings.papers?.find((item) => normalizePath(item.pdfPath || "") === path);
    const valid = new Set();
    if (paper) {
      for (const mark of this.ensureResearchWorkspace(paper).highlights || []) {
        if (normalizePath(mark.pdfPath || paper.pdfPath || "") !== path) continue;
        valid.add(`paperlib:${mark.pdfAnnotationId || mark.id}`);
      }
      // paper.annotations（长按拖出摘录的标注）同样会写回 PDF，不能当作孤儿删除
      for (const mark of paper.annotations || []) {
        if (normalizePath(mark.pdfPath || paper.pdfPath || "") !== path) continue;
        valid.add(`paperlib:${mark.pdfAnnotationId || mark.id}`);
      }
      for (const stroke of this.ensureResearchWorkspace(paper).inkStrokes || []) {
        if (normalizePath(stroke.pdfPath || paper.pdfPath || "") !== path) continue;
        valid.add(`paperlib:${stroke.pdfAnnotationId || stroke.id}`);
      }
      for (const shape of this.ensureResearchWorkspace(paper).pdfShapes || []) {
        if (normalizePath(shape.pdfPath || paper.pdfPath || "") !== path) continue;
        valid.add(`paperlib:${shape.pdfAnnotationId || shape.id}`);
      }
    }
    return this.mutateLocalPdf(path, async (document) => {
      let changed = false;
      document.getPages().forEach((page) => {
        const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
        if (!annots) return;
        for (let index = annots.size() - 1; index >= 0; index -= 1) {
          const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
          if (!dictionary) continue;
          const value = this.readPdfAnnotationString(document, dictionary, "NM");
          if (!value.startsWith("paperlib:") || valid.has(value)) continue;
          annots.remove(index);
          changed = true;
        }
      });
      return changed;
    });
  },
};

export { writebackMethods };
