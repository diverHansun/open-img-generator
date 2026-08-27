export function imageDownloadUrl(imageId: string): string {
  return `/api/images/${encodeURIComponent(imageId)}/download`;
}

/** Starts a browser-owned download/navigation inside the current user gesture. */
export function triggerImageDownload(imageId: string): void {
  const anchor = document.createElement('a');
  anchor.href = imageDownloadUrl(imageId);
  anchor.download = '';
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
