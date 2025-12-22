import './BackgroundTiles.css'

type Tile = {
  src: string
  top: string
  left: string
  size: number
  rotate: string
  opacity: number
}

const TILES: Tile[] = [
  { src: '/inspiration/look-1.svg', top: '6%', left: '4%', size: 76, rotate: '-10deg', opacity: 0.18 },
  { src: '/inspiration/look-2.svg', top: '12%', left: '78%', size: 64, rotate: '8deg', opacity: 0.16 },
  { src: '/inspiration/look-3.svg', top: '22%', left: '12%', size: 70, rotate: '12deg', opacity: 0.14 },
  { src: '/inspiration/look-4.svg', top: '28%', left: '86%', size: 82, rotate: '-6deg', opacity: 0.16 },
  { src: '/inspiration/look-2.svg', top: '40%', left: '6%', size: 92, rotate: '-14deg', opacity: 0.12 },
  { src: '/inspiration/look-1.svg', top: '46%', left: '82%', size: 74, rotate: '10deg', opacity: 0.12 },
  { src: '/inspiration/look-4.svg', top: '60%', left: '10%', size: 66, rotate: '6deg', opacity: 0.14 },
  { src: '/inspiration/look-3.svg', top: '64%', left: '88%', size: 90, rotate: '-10deg', opacity: 0.12 },
  { src: '/inspiration/look-1.svg', top: '76%', left: '18%', size: 84, rotate: '14deg', opacity: 0.12 },
  { src: '/inspiration/look-2.svg', top: '80%', left: '74%', size: 72, rotate: '-8deg', opacity: 0.14 },
  { src: '/inspiration/look-3.svg', top: '90%', left: '8%', size: 64, rotate: '9deg', opacity: 0.12 },
  { src: '/inspiration/look-4.svg', top: '92%', left: '86%', size: 68, rotate: '-12deg', opacity: 0.12 },
]

export default function BackgroundTiles() {
  return (
    <div className="bg-tiles" aria-hidden="true">
      {TILES.map((t, idx) => (
        <img
          key={`${t.src}-${idx}`}
          className="bg-tile"
          src={t.src}
          alt=""
          loading="lazy"
          style={
            {
              ['--t' as any]: t.top,
              ['--l' as any]: t.left,
              ['--s' as any]: `${t.size}px`,
              ['--r' as any]: t.rotate,
              ['--o' as any]: t.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}


