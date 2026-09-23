import { describe, it, expect, afterEach } from 'vitest';
import { jsPDF } from 'jspdf';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Not a test of app code — a regression lock on the jspdf@4 upgrade (fixes a
// critical ReDoS/path-traversal/PDF-injection advisory that applied to <=4.2.0's
// predecessor line; see npm audit).
//
// The app's own PDF export (src/app/(app)/programs/[programId]/view/page.tsx)
// runs in a browser against html2canvas output and real program data, which
// this sandbox cannot exercise — there's no authenticated session or live
// Firestore data here, and no way to visually inspect a rendered PDF. What this
// CAN verify is that the exact API surface that page calls — the constructor
// options, addImage, addPage, save — still behaves the same against v4 as it
// did against v2. If a major version changed any of those signatures or their
// runtime behaviour, this is where it would show up.
//
// Someone should still click "Download PDF" once after this ships, to confirm
// the visual output — this test cannot substitute for that.

// Smallest possible PNG (1x1, transparent) — a stand-in for html2canvas's
// data-URI output, which is what addImage actually receives in the app.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('jspdf v4 API surface (matches programs/[programId]/view/page.tsx)', () => {
  it('constructs with the same options the app passes', () => {
    // orientation/unit/format/compress — exactly what the app's handleDownloadPDF sends.
    expect(() => new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })).not.toThrow();
  });

  it('adds an image and a page the same way the app does, per-page', () => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });

    // First page: addImage only (no addPage before the first page).
    expect(() => pdf.addImage(TINY_PNG, 'PNG', 10, 10, 50, 30)).not.toThrow();

    // Subsequent pages: addPage() then addImage(), as the loop in
    // handleDownloadPDF does for pageIndex > 0.
    pdf.addPage();
    expect(() => pdf.addImage(TINY_PNG, 'PNG', 10, 10, 50, 30)).not.toThrow();

    expect(pdf.getNumberOfPages()).toBe(2);
  });

  it('produces real PDF bytes, not an empty or corrupt buffer', () => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(TINY_PNG, 'PNG', 10, 10, 50, 30);

    // save() itself triggers a browser download API this Node environment
    // doesn't have, so output('arraybuffer') stands in to inspect the bytes
    // save() would have written — same PDF, different sink.
    const bytes = pdf.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(500);

    const header = new TextDecoder().decode(new Uint8Array(bytes, 0, 5));
    expect(header).toBe('%PDF-');
  });

  describe('save()', () => {
    // Node has no browser download API, so jsPDF's Node fallback for save()
    // writes the file straight to disk at whatever path it's given — a real
    // side effect the first version of this test didn't account for, and which
    // left a stray smoke-test.pdf sitting in the repo root on every run. Every
    // save() in this block goes to a fresh temp directory, removed afterward,
    // so the test suite touches nothing outside of it.
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('returns without throwing (fire-and-forget, as the app calls it)', () => {
      dir = mkdtempSync(join(tmpdir(), 'jspdf-smoke-'));
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      pdf.addImage(TINY_PNG, 'PNG', 10, 10, 50, 30);
      // The app calls pdf.save(fileName) without awaiting it. v4's save()
      // returns a Promise for one overload (v2's was void) — either way, not
      // awaiting it must not throw synchronously or produce an unhandled
      // rejection here.
      expect(() => pdf.save(join(dir, 'smoke-test.pdf'))).not.toThrow();
    });

    it('actually writes a PDF, confirming the call really ran', () => {
      dir = mkdtempSync(join(tmpdir(), 'jspdf-smoke-'));
      const target = join(dir, 'smoke-test.pdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      pdf.addImage(TINY_PNG, 'PNG', 10, 10, 50, 30);
      pdf.save(target);
      expect(existsSync(target)).toBe(true);
    });
  });
});
