import { useEffect, useRef } from "react";

let observer: IntersectionObserver | undefined;
const devices = new Set<Element>();

/** Reference artwork floats as one perspective-transformed object. */
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
        <img
          className="luminous-device-art"
          src={
            new URL("../../assets/luminous-server-v2.png", import.meta.url).href
          }
          alt=""
          draggable={false}
        />
      </span>
      <span className="luminous-device-halo" />
    </span>
  );
}
