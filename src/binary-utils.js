/* 二进制工具：无压缩 zip 构造（crc32/createStoredZip，用于自更新安装包校验）
   与 base64/DataURL 转换。纯函数，不依赖 Obsidian。 */

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function littleEndian(value, length) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  if (length === 2) view.setUint16(0, value & 0xffff, true);
  else view.setUint32(0, value >>> 0, true);
  return bytes;
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  bytes.forEach((byte) => { crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); });
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = content instanceof Uint8Array ? content : encoder.encode(String(content));
    const checksum = crc32(data);
    const localHeader = concatBytes([
      littleEndian(0x04034b50, 4), littleEndian(20, 2), littleEndian(0, 2), littleEndian(0, 2),
      littleEndian(0, 2), littleEndian(0x21, 2), littleEndian(checksum, 4), littleEndian(data.length, 4),
      littleEndian(data.length, 4), littleEndian(nameBytes.length, 2), littleEndian(0, 2), nameBytes
    ]);
    localParts.push(localHeader, data);
    centralParts.push(concatBytes([
      littleEndian(0x02014b50, 4), littleEndian(20, 2), littleEndian(20, 2), littleEndian(0, 2),
      littleEndian(0, 2), littleEndian(0, 2), littleEndian(0x21, 2), littleEndian(checksum, 4),
      littleEndian(data.length, 4), littleEndian(data.length, 4), littleEndian(nameBytes.length, 2),
      littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 2), littleEndian(0, 2),
      littleEndian(0, 4), littleEndian(offset, 4), nameBytes
    ]));
    offset += localHeader.length + data.length;
  });
  const central = concatBytes(centralParts);
  const end = concatBytes([
    littleEndian(0x06054b50, 4), littleEndian(0, 2), littleEndian(0, 2),
    littleEndian(entries.length, 2), littleEndian(entries.length, 2), littleEndian(central.length, 4),
    littleEndian(offset, 4), littleEndian(0, 2)
  ]);
  return concatBytes([...localParts, central, end]);
}

function arrayBufferToDataUrl(buffer, mime = "application/octet-stream") {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value) {
  const base64 = String(value || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    const bytes = Buffer.from(base64, "base64");
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/* concatBytes、littleEndian、crc32 是 createStoredZip 的内部构件，不导出。 */
export { arrayBufferToBase64, arrayBufferToDataUrl, base64ToArrayBuffer, createStoredZip };
