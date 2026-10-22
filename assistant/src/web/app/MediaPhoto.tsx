import { useState, type CSSProperties, type SyntheticEvent } from 'react';
import { MEDIA } from './visual-assets.js';

export function MediaPhoto({
  src,
  alt,
  className,
  style,
  fallback = MEDIA.fallback,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  fallback?: string;
}) {
  const [current, setCurrent] = useState(src);
  const [failed, setFailed] = useState(false);

  function onError(_e: SyntheticEvent<HTMLImageElement>) {
    if (current !== fallback) {
      setCurrent(fallback);
      return;
    }
    setFailed(true);
  }

  if (failed) {
    return (
      <div
        className={className ? `${className} media-photo-fallback` : 'media-photo-fallback'}
        style={style}
        role="img"
        aria-label={alt || undefined}
      />
    );
  }

  return (
    <img
      className={className}
      style={style}
      src={current}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
}
