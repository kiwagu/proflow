import { describe, expect, it } from 'vitest';
import { scormKind } from './scorm.js';

const MANIFEST = `<?xml version="1.0"?>
<manifest identifier="course" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>Intro course</title>
      <item identifier="i1" identifierref="r1"><title>Lesson one</title></item>
      <item identifier="i2" identifierref="r2" parameters="?p=2"><title>Lesson two</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="lesson1/index.html"/>
    <resource identifier="r2" type="webcontent" href="lesson2/index.html"/>
  </resources>
</manifest>`;

describe('scorm kind', () => {
  const entries = [
    { path: 'course/imsmanifest.xml', size: 1, mime: 'application/xml' },
    { path: 'course/lesson1/index.html', size: 1, mime: 'text/html' },
  ];

  it('detects a manifest under a top-level folder', () => {
    expect(scormKind.detect(entries)).toBe(true);
    expect(
      scormKind.detect([{ path: 'a.txt', size: 1, mime: 'text/plain' }])
    ).toBe(false);
  });

  it('reads version, title, and launchable items relative to the manifest', async () => {
    const manifest = await scormKind.manifest(entries, async (path) =>
      path === 'course/imsmanifest.xml' ? MANIFEST : null
    );
    expect(manifest).toMatchObject({
      version: '1.2',
      title: 'Intro course',
      launchPath: 'course/lesson1/index.html',
      items: [
        { title: 'Lesson one', launchPath: 'course/lesson1/index.html' },
        { title: 'Lesson two', launchPath: 'course/lesson2/index.html?p=2' },
      ],
    });
  });

  it('decodes XML entities in hrefs, parameters, and titles', async () => {
    const xml = `<?xml version="1.0"?>
<manifest identifier="course">
  <metadata><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>Q &amp; A</title>
      <item identifier="i1" identifierref="r1" parameters="?width=1200&amp;height=695">
        <title>Lesson &#x2014; one</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" type="webcontent" href="1/start.html"/>
  </resources>
</manifest>`;
    const manifest = await scormKind.manifest(
      [{ path: 'imsmanifest.xml', size: 1, mime: 'application/xml' }],
      async () => xml
    );
    expect(manifest).toMatchObject({
      title: 'Q & A',
      launchPath: '1/start.html?width=1200&height=695',
      items: [
        {
          title: 'Lesson — one',
          launchPath: '1/start.html?width=1200&height=695',
        },
      ],
    });
  });
});
