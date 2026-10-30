import { useEffect, useRef, type CSSProperties } from "react";

let observer: IntersectionObserver | undefined;
const devices = new Set<Element>();

/** Three visible CSS faces; the device floats as one object, never its labels. */
export default function ServerSculpture({
  tone = "blue",
  small = false,
}: {
  tone?: string;
  small?: boolean;
}) {
  const device = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = device.current!;
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries)
        (entry.target as HTMLElement).dataset.active = String(
          entry.isIntersecting,
        );
    });
    devices.add(element);
    observer.observe(element);
    return () => {
      observer?.unobserve(element);
      devices.delete(element);
      if (!devices.size) {
        observer?.disconnect();
        observer = undefined;
      }
    };
  }, []);
  return (
    <span
      ref={device}
      className="luminous-device"
      data-small={small}
      data-tone={tone}
      data-active="false"
      aria-hidden="true"
    >
      <span className="luminous-device-shadow" />
      <span className="luminous-device-float">
        {[0, 1, 2].map((layer) => (
          <span
            className="luminous-cube"
            key={layer}
            style={{ "--layer": layer } as CSSProperties}
          >
            <span className="luminous-cube-top">
              <span>✦</span>
            </span>
            <span className="luminous-cube-front">
              <i />
              <i />
              <i />
              <b />
            </span>
            <span className="luminous-cube-right">
              <i />
              <i />
              <b />
            </span>
          </span>
        ))}
      </span>
      <span className="luminous-device-halo" />
    </span>
  );
}
