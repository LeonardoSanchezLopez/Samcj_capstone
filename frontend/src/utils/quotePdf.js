const winAnsiMap = {
  '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135,
  'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142,
  '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151,
  '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159
};

function encodeWinAnsi(text = '') {
  const out = [];
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (code <= 255) out.push(code);
    else if (winAnsiMap[ch] != null) out.push(winAnsiMap[ch]);
    else out.push(63);
  }
  return new Uint8Array(out);
}

const ascii = text => new TextEncoder().encode(text);
const concat = arrays => {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  arrays.forEach(a => { out.set(a, p); p += a.length; });
  return out;
};

function pdfEscapeBytes(text) {
  const bytes = encodeWinAnsi(text);
  const out = [];
  for (const b of bytes) {
    if (b === 40 || b === 41 || b === 92) out.push(92, b);
    else out.push(b);
  }
  return new Uint8Array(out);
}

function textCommand(text, x, y, size = 10, bold = false) {
  return concat([
    ascii(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (`),
    pdfEscapeBytes(text),
    ascii(') Tj ET\n')
  ]);
}

function wrap(text, max = 74) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if (test.length > max && line) { lines.push(line); line = word; }
    else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

async function buildCarJpeg(imageUrl, alpha = .42) {
  const img = new Image();
  img.src = imageUrl;
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
  const canvas = document.createElement('canvas');
  canvas.width = 554; canvas.height = 554;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 554, 554);
  ctx.drawImage(img, 0, 0, 554, 554);
  ctx.fillStyle = `rgba(8,14,22,${alpha})`;
  ctx.beginPath(); ctx.moveTo(198,258); ctx.lineTo(225,241); ctx.quadraticCurveTo(267,231,314,234); ctx.lineTo(309,266); ctx.lineTo(205,270); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(328,234); ctx.quadraticCurveTo(362,238,392,250); ctx.lineTo(409,260); ctx.lineTo(409,264); ctx.lineTo(332,264); ctx.closePath(); ctx.fill();
  const base64 = canvas.toDataURL('image/jpeg', .92).split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, width: 554, height: 554 };
}

function makeObject(index, bodyBytes) {
  return concat([ascii(`${index} 0 obj\n`), bodyBytes, ascii('\nendobj\n')]);
}

export async function downloadQuotePdf({ fileName = 'cotizacion-samcj.pdf', carImageUrl, opacityAlpha = .42, data }) {
  const image = await buildCarJpeg(carImageUrl, opacityAlpha);
  const content = [];
  content.push(ascii('0.15 0.16 0.19 rg 0 0 595 842 re f\n'));
  content.push(ascii('1 1 1 rg 36 54 523 734 re f\n'));
  content.push(ascii('0.94 0.25 0.22 rg 36 734 523 54 re f\n'));
  content.push(ascii('1 1 1 rg\n'));
  content.push(textCommand('SAMCJ S.A.C.', 54, 758, 18, true));
  content.push(ascii('0.08 0.09 0.11 rg\n'));
  content.push(textCommand('COTIZACIÓN PRELIMINAR DE SERVICIO DE POLARIZADO', 54, 713, 14, true));
  content.push(textCommand(`Fecha de generación: ${data.generatedAt}`, 54, 694, 9));
  content.push(textCommand('CLIENTE', 54, 664, 11, true));
  content.push(textCommand(data.customerName, 54, 648, 11, true));
  content.push(textCommand(`Teléfono: ${data.phone}`, 54, 632, 9));
  if (data.maskedDni) content.push(textCommand(`DNI: ${data.maskedDni}`, 250, 632, 9));
  content.push(textCommand('CITA', 54, 600, 11, true));
  content.push(textCommand(`${data.date} · ${data.time}`, 54, 584, 10, true));
  wrap(data.location, 76).slice(0,2).forEach((line, i) => content.push(textCommand(line, 54, 568 - i*14, 9)));
  content.push(textCommand('VEHÍCULO', 54, 524, 11, true));
  content.push(textCommand(`${data.vehicleCategory} · ${data.vehicle}`, 54, 508, 10, true));
  content.push(textCommand('ELECCIÓN PRELIMINAR DEL CLIENTE', 54, 478, 11, true));
  content.push(textCommand(`Servicio: ${data.service}`, 54, 462, 9));
  content.push(textCommand(`Lámina: ${data.filmBrand} · ${data.filmQuality}`, 54, 447, 9));
  content.push(textCommand(`Tonalidad: ${data.tone}`, 54, 432, 9));
  content.push(ascii('q 230 0 0 230 182 188 cm /Im1 Do Q\n'));
  content.push(textCommand('Vista referencial de la opacidad de las lunas según la opción seleccionada.', 70, 170, 8));
  content.push(ascii('0.94 0.25 0.22 rg 54 118 487 38 re f\n'));
  content.push(ascii('1 1 1 rg\n'));
  content.push(textCommand(`Cotización preliminar: ${data.quote}`, 72, 131, 16, true));
  content.push(ascii('0.08 0.09 0.11 rg\n'));
  const disclaimer = 'La configuración mostrada corresponde a la elección preliminar realizada por el cliente durante la reserva de la cita. La selección definitiva será validada con el especialista antes de iniciar el servicio.';
  wrap(disclaimer, 94).slice(0,3).forEach((line, i) => content.push(textCommand(line, 54, 92 - i*13, 8)));

  const stream = concat(content);
  const objects = [];
  objects[1] = makeObject(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'));
  objects[2] = makeObject(2, ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  objects[3] = makeObject(3, ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 7 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>'));
  objects[4] = makeObject(4, concat([ascii(`<< /Length ${stream.length} >>\nstream\n`), stream, ascii('endstream')]));
  objects[5] = makeObject(5, ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  objects[6] = makeObject(6, concat([ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`), image.bytes, ascii('\nendstream')]));
  objects[7] = makeObject(7, ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));

  const header = ascii('%PDF-1.4\n%âãÏÓ\n');
  let offset = header.length;
  const offsets = [0];
  const bodyParts = [header];
  for (let i = 1; i <= 7; i++) { offsets[i] = offset; bodyParts.push(objects[i]); offset += objects[i].length; }
  const xrefOffset = offset;
  const xref = [`xref\n0 8\n`, '0000000000 65535 f \n'];
  for (let i = 1; i <= 7; i++) xref.push(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  const trailer = `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  bodyParts.push(ascii(xref.join(''))); bodyParts.push(ascii(trailer));
  const blob = new Blob(bodyParts, { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
