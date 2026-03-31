import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Download } from 'lucide-react';

type DownloadActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function DownloadActionButton({
  children,
  className,
  type = 'button',
  ...props
}: DownloadActionButtonProps) {
  const merged =
    ['button', 'button-secondary', 'table-action-button', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={merged} {...props}>
      <Download className="table-action-icon" aria-hidden />
      {children}
    </button>
  );
}
