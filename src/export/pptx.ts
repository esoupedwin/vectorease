/**
 * Minimal .pptx writer: one 16:9 slide with every shape as a native PowerPoint freeform
 * (DrawingML <a:custGeom>), so the result is fully editable with PowerPoint's own "Edit Points".
 */
import JSZip from "jszip";
import type { Shape } from "../types";
import { segments, shapeBBox } from "../geom";
import { visualBBox } from "./svg";
import { esc } from "./svg";

const EMU_PER_PX = 9525; // 96 dpi
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

function hex6(c: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (m) return m[1].toUpperCase();
  const s = /^#?([0-9a-f]{3})$/i.exec(c.trim());
  if (s) return s[1].split("").map((ch) => ch + ch).join("").toUpperCase();
  return "000000";
}

function alpha(op: number): string {
  return op >= 1 ? "" : `<a:alpha val="${Math.round(Math.max(0, Math.min(1, op)) * 100000)}"/>`;
}

function shapeXml(s: Shape, idx: number, scale: number, originX: number, originY: number): string {
  const b = shapeBBox(s);
  if (!b || s.anchors.length < 2) return "";
  const offX = Math.round((b.x - originX) * scale);
  const offY = Math.round((b.y - originY) * scale);
  const cx = Math.max(1, Math.round(b.w * scale));
  const cy = Math.max(1, Math.round(b.h * scale));
  const px = (x: number) => Math.round((x - b.x) * scale);
  const py = (y: number) => Math.round((y - b.y) * scale);
  const pt = (x: number, y: number) => `<a:pt x="${px(x)}" y="${py(y)}"/>`;

  let path = `<a:moveTo>${pt(s.anchors[0].p.x, s.anchors[0].p.y)}</a:moveTo>`;
  for (const seg of segments(s)) {
    if (seg.straight) path += `<a:lnTo>${pt(seg.p3.x, seg.p3.y)}</a:lnTo>`;
    else path += `<a:cubicBezTo>${pt(seg.c1.x, seg.c1.y)}${pt(seg.c2.x, seg.c2.y)}${pt(seg.p3.x, seg.p3.y)}</a:cubicBezTo>`;
  }
  if (s.closed) path += `<a:close/>`;

  const fill =
    s.fill === "none"
      ? `<a:noFill/>`
      : `<a:solidFill><a:srgbClr val="${hex6(s.fill)}">${alpha(s.fillOpacity * s.opacity)}</a:srgbClr></a:solidFill>`;
  const ln =
    s.stroke === "none" || s.strokeWidth <= 0
      ? `<a:ln><a:noFill/></a:ln>`
      : `<a:ln w="${Math.max(1, Math.round(s.strokeWidth * scale))}" cap="rnd"><a:solidFill><a:srgbClr val="${hex6(s.stroke)}">${alpha(s.strokeOpacity * s.opacity)}</a:srgbClr></a:solidFill><a:round/></a:ln>`;

  return (
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${idx + 2}" name="${esc(s.name || "Shape")}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${offX}" y="${offY}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>` +
    `<a:pathLst><a:path w="${cx}" h="${cy}" fill="${s.fill === "none" ? "none" : "norm"}">${path}</a:path></a:pathLst>` +
    `</a:custGeom>` +
    fill +
    ln +
    `</p:spPr>` +
    `<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US"/></a:p></p:txBody>` +
    `</p:sp>`
  );
}

const NS_P = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const PRESENTATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS_P} saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle>
</p:presentation>`;

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS_P}>
<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>
</p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS_P} type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="VectorEase">
<a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
<a:objectDefaults/><a:extraClrSchemeLst/>
</a:theme>`;

function coreXml(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title><dc:creator>VectorEase</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>VectorEase</Application><Slides>1</Slides></Properties>`;

/**
 * Build a .pptx blob. Shapes are placed with 1 document px = 1/96 inch and centred on the slide;
 * if they would overflow the slide they are scaled down to fit with a margin.
 */
export async function shapesToPptx(shapes: Shape[], title = "VectorEase export"): Promise<Blob> {
  const visible = shapes.filter((s) => s.visible && s.anchors.length >= 2);
  const bounds = visualBBox(visible) ?? { x: 0, y: 0, w: 1, h: 1 };
  const margin = 0.05;
  const maxW = SLIDE_W * (1 - margin * 2);
  const maxH = SLIDE_H * (1 - margin * 2);
  let scale = EMU_PER_PX;
  if (bounds.w * scale > maxW || bounds.h * scale > maxH) {
    scale = Math.min(maxW / bounds.w, maxH / bounds.h);
  }
  const groupW = bounds.w * scale;
  const groupH = bounds.h * scale;
  // Shift so the group is centred on the slide: we express origin in document units.
  const originX = bounds.x - (SLIDE_W - groupW) / 2 / scale;
  const originY = bounds.y - (SLIDE_H - groupH) / 2 / scale;

  const spTree = visible.map((s, i) => shapeXml(s, i, scale, originX, originY)).join("");
  const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS_P}>
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${spTree}
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("docProps/core.xml", coreXml(title));
  zip.file("docProps/app.xml", APP_XML);
  zip.file("ppt/presentation.xml", PRESENTATION);
  zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS);
  zip.file("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", SLIDE_MASTER_RELS);
  zip.file("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", SLIDE_LAYOUT_RELS);
  zip.file("ppt/slides/slide1.xml", slide);
  zip.file("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS);
  zip.file("ppt/theme/theme1.xml", THEME);
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    compression: "DEFLATE",
  });
}
