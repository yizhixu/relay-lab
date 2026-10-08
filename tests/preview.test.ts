import { it, expect } from 'vitest';
import { extractArtifacts, previewDocument } from '../src/preview';

it('extracts fenced HTML and SVG without surrounding explanations, preserving animations', () => {
 const html='<html><body><svg><circle r="5"/></svg><script>requestAnimationFrame(tick)</script></body></html>';
 const svg='<svg viewBox="0 0 20 20"><circle r="5"><animate attributeName="r" values="5;8;5" dur="1s" repeatCount="indefinite"/></circle></svg>';
 expect(extractArtifacts('说明\n```html\n'+html+'\n```\n```svg\n'+svg+'\n```\n结束')).toEqual([{kind:'HTML',source:html},{kind:'SVG',source:svg}]);
 expect(extractArtifacts('```javascript\nconsole.log("<svg>")\n```')).toEqual([]);
});
it('recognizes raw documents and SVG and leaves plain text as text', () => {
 expect(extractArtifacts('说明\n<!DOCTYPE html><html><body>hi</body></html>\n完成')[0].source).toBe('<!DOCTYPE html><html><body>hi</body></html>');
 expect(extractArtifacts('这里是 SVG：\n<svg><rect width="10" height="10"/></svg>\n完成')).toEqual([{kind:'SVG',source:'<svg><rect width="10" height="10"/></svg>'}]);
 expect(extractArtifacts('<div class="demo">片段</div>')[0].kind).toBe('HTML');
 expect(extractArtifacts('“2024-06-20”')).toEqual([]);
});
it('places a restrictive CSP before generated code without altering the stored source', () => {
 const source='<!DOCTYPE html><html><head><script>draw()</script></head><body>demo</body></html>';
 const doc=previewDocument({kind:'HTML',source});
 expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script>draw()'));
 expect(doc).toContain("connect-src 'none'");expect(doc).toContain("script-src 'unsafe-inline'");
 expect(source).toContain('<!DOCTYPE html>');
});

it('preserves the complete outer SVG when SVG elements are nested', () => {
 const svg='<svg viewBox="0 0 100 100"><svg><circle r="5"/></svg><rect id="lost" width="10" height="10"/></svg>';
 expect(extractArtifacts('说明：'+svg+'结束')).toEqual([{kind:'SVG',source:svg}]);
});
