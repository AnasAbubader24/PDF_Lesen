import { useState } from 'react';
import { Icon } from '@ui5/webcomponents-react';

export function PDFDropArea({ disabled, label, hint, onChoose, onUpload, onInvalid }: {
  disabled: boolean; label: string; hint: string; onChoose: () => void;
  onUpload: (file: File) => void; onInvalid: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  return <div className={`pdf-drop-area${dragging ? ' dragging' : ''}`} role="button" tabIndex={disabled ? -1 : 0}
    aria-label={label} aria-disabled={disabled}
    onClick={() => { if (!disabled) onChoose(); }}
    onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onChoose(); } }}
    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; if (!disabled) setDragging(true); }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
    onDrop={e => {
      e.preventDefault(); setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length !== 1 || !/\.pdf$/i.test(files[0].name)) { onInvalid(); return; }
      onUpload(files[0]);
    }}>
    <Icon name="upload-to-cloud"/><strong>{label}</strong><span>{hint}</span>
  </div>;
}
