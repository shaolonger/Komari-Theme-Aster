import { useId } from 'react';

export function SettingSwitch({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <label className="studio-setting-switch"><span><strong>{title}</strong><small id={id}>{detail}</small></span><input type="checkbox" role="switch" aria-describedby={id} checked={checked} onChange={event => onChange(event.target.checked)} /></label>;
}

