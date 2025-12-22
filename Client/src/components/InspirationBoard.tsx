import React from 'react'
import './InspirationBoard.css'

type InspirationImage = {
  src: string
  alt: string
}

type Props = {
  title: string
  images: InspirationImage[]
}

export default function InspirationBoard({ title, images }: Props) {
  return (
    <aside className="inspo-board" aria-label={title}>
      <div className="inspo-header">
        <h3 className="inspo-title">{title}</h3>
      </div>
      <div className="inspo-grid">
        {images.map((img) => (
          <div key={img.src} className="inspo-tile">
            <img className="inspo-img" src={img.src} alt={img.alt} loading="lazy" />
          </div>
        ))}
      </div>
    </aside>
  )
}


