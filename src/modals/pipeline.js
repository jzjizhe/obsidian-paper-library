/* 本地管线弹窗：开启图片识别、安装本地处理管线。 */

import { Modal } from "obsidian";
import { formatAIFileSize } from "../text-utils.js";

class EnableFigureRecognitionModal extends Modal {
  constructor(app, plugin, onComplete) {
    super(app);
    this.plugin = plugin;
    this.onComplete = onComplete;
    this.installing = false;
  }

  onOpen() {
    this.contentEl.addClass("paperlib-modal");
    this.contentEl.createEl("h2", { text: "开启 PDF 图片识别？" });
    this.contentEl.createEl("p", {
      text: "开启后才会下载 DocLayout-YOLO ONNX 模型与独立 Python 运行时，预计占用约 240–300 MB。识别过程完全在本机完成。"
    });
    const details = this.contentEl.createEl("ul");
    details.createEl("li", { text: "ONNX 模型约 72 MB；运行时不再安装 PyTorch。" });
    details.createEl("li", { text: "下载仅执行一次；分析结果会按 PDF 修改时间缓存。" });
    details.createEl("li", { text: "以后可关闭功能，或在设置中删除运行时与模型释放空间。" });
    const status = this.contentEl.createDiv({ cls: "paperlib-runtime-install-status", text: "等待确认" });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    const cancel = buttons.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => {
      if (!this.installing) this.close();
    });
    const install = buttons.createEl("button", { cls: "mod-cta", text: "下载并开启" });
    install.addEventListener("click", async () => {
      if (this.installing) return;
      this.installing = true;
      cancel.disabled = true;
      install.disabled = true;
      try {
        await this.plugin.installDocLayoutRuntime((message) => status.setText(message));
        this.onComplete?.();
        this.close();
      } catch (error) {
        console.error("Paper Library: failed to install DocLayout-YOLO runtime", error);
        status.setText(`安装失败：${error.message || error}`);
        cancel.disabled = false;
        install.disabled = false;
        this.installing = false;
      }
    });
  }

  onClose() { this.contentEl.empty(); }
}

class InstallLocalPipelineModal extends Modal {
  constructor(app, plugin, onComplete) {
    super(app);
    this.plugin = plugin;
    this.onComplete = onComplete;
    this.installing = false;
  }

  onOpen() {
    const status = this.plugin.getLocalPipelinePackStatus();
    this.contentEl.addClass("paperlib-modal", "paperlib-mineru-modal");
    this.contentEl.createEl("h2", { text: "安装本地解析模型" });
    this.contentEl.createEl("p", {
      text: "按当前系统下载运行库和模型。安装包不包含 PyTorch；PDF、页面图像与解析结果始终留在本机。"
    });
    const details = this.contentEl.createEl("ul", { cls: "paperlib-mineru-install-details" });
    details.createEl("li", { text: "流程：PP-DocLayoutV2 → PP-FormulaNet-plus-M → PP-OCRv6 → Table → Markdown。" });
    details.createEl("li", { text: `模型约 ${formatAIFileSize(status.totalBytes || 0)}，运行时只下载 ${process.platform}-${process.arch} 对应文件。` });
    details.createEl("li", { text: "支持断点续传和 SHA-256 校验；取消后可继续下载。" });
    details.createEl("li", { text: "未安装或运行失败时，Composer 会直接发送完整原文件。" });
    const progress = this.contentEl.createDiv({ cls: "paperlib-mineru-install-progress" });
    const progressLabel = progress.createEl("span", { text: "等待开始" });
    const progressTrack = progress.createDiv({ cls: "paperlib-mineru-progress-track" });
    const progressBar = progressTrack.createDiv({ cls: "paperlib-mineru-progress-bar" });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons paperlib-mineru-modal-actions" });
    const cancel = buttons.createEl("button", { cls: "paperlib-mineru-secondary", text: "取消" });
    const install = buttons.createEl("button", { cls: "paperlib-mineru-primary", text: "下载并安装" });
    cancel.addEventListener("click", () => {
      if (!this.installing) return this.close();
      this.plugin.cancelLocalPipelineInstall();
      progressLabel.setText("正在取消…");
    });
    install.addEventListener("click", async () => {
      if (this.installing) return;
      this.installing = true;
      install.disabled = true;
      progressBar.style.width = "4%";
      let pulse = 4;
      try {
        await this.plugin.installLocalPipelinePack((message) => {
          progressLabel.setText(message);
          const match = String(message).match(/模型\s+([\d.]+)\s*(KB|MB|GB)\s*\/\s*([\d.]+)\s*(KB|MB|GB)/i);
          if (match) {
            const unit = { KB: 1, MB: 1024, GB: 1024 * 1024 };
            const current = Number(match[1]) * unit[match[2].toUpperCase()];
            const total = Number(match[3]) * unit[match[4].toUpperCase()];
            progressBar.style.width = `${Math.min(100, Math.max(4, current / total * 100))}%`;
          } else {
            pulse = Math.min(20, pulse + 1);
            progressBar.style.width = `${pulse}%`;
          }
        });
        progressBar.style.width = "100%";
        this.onComplete?.();
        window.setTimeout(() => this.close(), 350);
      } catch (error) {
        console.error("Paper Library: local document pipeline installation failed", error);
        progressLabel.setText(`安装未完成：${error?.message || error}`);
        install.disabled = false;
        this.installing = false;
      }
    });
  }

  onClose() {
    if (this.installing) this.plugin.cancelLocalPipelineInstall();
    this.contentEl.empty();
  }
}

export {
  EnableFigureRecognitionModal,
  InstallLocalPipelineModal
};
