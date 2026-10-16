import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Book } from '../../shared/types';

const coverPalettes = [
  ['#dbe4d8', '#2d5548'], ['#e8d7c7', '#704a37'], ['#dadfe8', '#3e5068'],
  ['#e7dfbf', '#645c33'], ['#e2d7df', '#694d63'], ['#d2e1df', '#345c5a'],
  ['#e6d7ce', '#784f46'], ['#dedfcb', '#575d36'],
];

export function BookCover({ book, detail = false }: { book: Book; detail?: boolean }) {
  const src = book.coverUrl;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const hash = Array.from(book.title + book.author).reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0);
  const palette = coverPalettes[Math.abs(hash) % coverPalettes.length];
  const style = { '--cover-background': palette[0], '--cover-ink': palette[1] } as CSSProperties;
  return (
    <div className={'book-cover' + (detail ? ' book-cover--detail' : '')}>
      {src && !failed ? (
        <img src={src} alt={'Portada de ' + book.title} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className={'cover-face cover-design-' + (Math.abs(hash) % 3)} style={style} aria-hidden="true">
          <div className="cover-spine" />
          <div className="cover-ornament"><span /><span /><span /></div>
          <div className="cover-title-region"><span className="cover-title">{book.title}</span></div>
          <span className="cover-rule" />
        </div>
      )}
    </div>
  );
}
