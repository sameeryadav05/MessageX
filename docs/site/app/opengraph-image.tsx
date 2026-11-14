import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'MessageX — Self-hosted message broker documentation';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          color: '#f8fafc',
          background: 'linear-gradient(135deg, #0b1020 0%, #151c35 55%, #1e1b4b 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 54,
              height: 54,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              background: '#6366f1',
              fontSize: 30,
              fontWeight: 800,
            }}
          >
            M
          </div>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700 }}>MessageX</div>
          <div style={{ marginLeft: 12, color: '#a5b4fc', fontSize: 20 }}>DOCUMENTATION</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 68, lineHeight: 1.05, fontWeight: 800, letterSpacing: -2 }}>
            Messaging infrastructure,
            <br />
            made understandable.
          </div>
          <div style={{ maxWidth: 850, color: '#cbd5e1', fontSize: 27, lineHeight: 1.4 }}>
            Self-hosted message broker · TCP protocol · PostgreSQL · Docker · Node.js SDK
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#a5b4fc', fontSize: 20 }}>
          <span>Architecture · Guides · API Reference</span>
          <span>messagex.imsameer.me</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
