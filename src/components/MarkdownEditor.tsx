"use client";

import dynamic from "next/dynamic";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textareaProps?: Record<string, any>;
}

export default function MarkdownEditor({ value, onChange, placeholder, height = 300, textareaProps }: Props) {
  return (
    <div data-color-mode="light">
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? "")}
        preview="edit"
        height={height}
        textareaProps={{ placeholder, ...textareaProps }}
      />
    </div>
  );
}
