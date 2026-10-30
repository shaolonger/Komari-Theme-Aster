import { useEffect, useRef, type CSSProperties } from "react";
import ServerSculpture from "./ServerSculpture";
import { MOTION_EVENT, motionAllowed } from "./motion";

// A ray/sphere intersection shades a real rotating sphere. All resources are
// local; no map service, external texture request or 3D runtime is required.
const vertex =
  "attribute vec2 position; varying vec2 uv; void main(){uv=position;gl_Position=vec4(position,0.,1.);}";
const fragment = `precision mediump float;
varying vec2 uv; uniform sampler2D earth; uniform sampler2D night; uniform sampler2D clouds; uniform float angle;
void main(){
 vec2 p=uv*1.08; float r=dot(p,p);
 if(r>1.){float a=exp(-26.*(sqrt(r)-1.))*.28;gl_FragColor=vec4(.35,.75,1.,a);return;}
 vec3 n=vec3(p.x,p.y,sqrt(1.-r)); vec3 viewNormal=n;
 float tilt=.4; n.yz=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*n.yz;
 n.xz=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*n.xz;
 vec2 t=vec2(.5+atan(n.x,n.z)/6.283185,.5-asin(n.y)/3.141593);
 vec3 surface=texture2D(earth,t).rgb;
 float light=.35+.65*max(0.,dot(viewNormal,normalize(vec3(-.45,.7,.8))));
 vec3 col=surface*vec3(.38,.55,1.12)*light;
 vec3 cities=texture2D(night,t).rgb;
 col+=cities*vec3(2.1,1.65,.9)*(1.2-light*.38);
 float cloud=texture2D(clouds,vec2(fract(t.x+angle*.012),t.y)).r;
 col=mix(col,vec3(.89,.96,1.)*max(.7,light),smoothstep(.16,.85,cloud)*.5);
 float rim=pow(1.-viewNormal.z,3.);
 col=mix(col,vec3(.55,.85,1.),rim*.72);
 gl_FragColor=vec4(col,1.);
}`;

function Earth() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      canvas.dataset.renderer = "fallback";
      return;
    }
    let disposed = false,
      raf = 0,
      visible = false,
      last = 0,
      angle = 0.65,
      loaded = false;
    const shaders: WebGLShader[] = [];
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      shaders.push(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
      canvas.dataset.renderer = "fallback";
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const textures = [0, 1, 2].map((unit) => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(
        gl.getUniformLocation(program, ["earth", "night", "clouds"][unit]),
        unit,
      );
      return texture;
    });
    const angleLocation = gl.getUniformLocation(program, "angle");
    const draw = () => {
      if (!loaded || disposed || gl.isContextLost()) return;
      const size = Math.max(
        1,
        Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 1.25)),
      );
      if (canvas.width !== size) {
        canvas.width = size;
        canvas.height = size;
        gl.viewport(0, 0, size, size);
      }
      gl.uniform1f(angleLocation, angle);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      canvas.dataset.frame = String(Number(canvas.dataset.frame || 0) + 1);
    };
    const canAnimate = () =>
      loaded &&
      visible &&
      !gl.isContextLost() &&
      !document.hidden &&
      motionAllowed();
    const tick = (time: number) => {
      raf = 0;
      if (!canAnimate() || disposed) return;
      if (time - last >= 40) {
        angle += Math.min(64, time - last) * 0.000025;
        last = time;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      canvas.dataset.running = String(canAnimate());
      draw();
      if (canAnimate()) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    let remaining = 3;
    const sources = [
      new URL("../../assets/luminous-earth-day-v2.jpg", import.meta.url).href,
      new URL("../../assets/luminous-earth-night-v2.jpg", import.meta.url).href,
      new URL("../../assets/luminous-earth-clouds-v2.jpg", import.meta.url)
        .href,
    ];
    const images = sources.map((source, unit) => {
      const image = new Image();
      image.onload = () => {
        if (disposed || gl.isContextLost()) return;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          image,
        );
        if (--remaining === 0) {
          loaded = true;
          canvas.dataset.renderer = "webgl";
          sync();
        }
      };
      image.onerror = () => {
        canvas.dataset.renderer = "fallback";
        sync();
      };
      image.src = source;
      return image;
    });
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      sync();
    });
    observer.observe(canvas);
    const resize = new ResizeObserver(draw);
    resize.observe(canvas);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener(MOTION_EVENT, sync);
    const onLost = (event: Event) => {
      event.preventDefault();
      loaded = false;
      cancelAnimationFrame(raf);
      canvas.dataset.renderer = "fallback";
      canvas.dataset.running = "false";
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      resize.disconnect();
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener(MOTION_EVENT, sync);
      canvas.removeEventListener("webglcontextlost", onLost);
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
      textures.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteBuffer(buffer);
      shaders.forEach((s) => gl.deleteShader(s));
      gl.deleteProgram(program);
      if (!canvas.isConnected)
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);
  return (
    <div className="luminous-earth">
      <div className="luminous-earth-fallback" />
      <canvas ref={ref} aria-hidden="true" />
      <div className="luminous-earth-sheen" />
    </div>
  );
}

export default function LuminousScene({
  variant = "globe",
}: {
  variant?: "globe" | "server" | "network";
}) {
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scene.current!;
    const surface = element.closest<HTMLElement>(
      ".luminous-hero,.instance-topbar",
    );
    if (!surface) return;
    const visibility = new IntersectionObserver((entries) => {
      element.dataset.active = String(entries[0].isIntersecting);
    });
    visibility.observe(element);
    const reset = () => {
      element.style.setProperty("--scene-x", "0deg");
      element.style.setProperty("--scene-y", "0deg");
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !motionAllowed()) return;
      const rect = surface.getBoundingClientRect();
      element.style.setProperty(
        "--scene-x",
        ((event.clientX - rect.left) / rect.width - 0.5) * 7 + "deg",
      );
      element.style.setProperty(
        "--scene-y",
        -((event.clientY - rect.top) / rect.height - 0.5) * 4 + "deg",
      );
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", reset);
    window.addEventListener(MOTION_EVENT, reset);
    return () => {
      visibility.disconnect();
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", reset);
      window.removeEventListener(MOTION_EVENT, reset);
    };
  }, []);
  return (
    <div
      ref={scene}
      className="luminous-scene"
      data-scene={variant}
      aria-hidden="true"
    >
      <div className="luminous-scene-light" />
      <img
        className="luminous-environment"
        src={
          new URL("../../assets/luminous-environment-v2.png", import.meta.url)
            .href
        }
        alt=""
        draggable={false}
      />
      <div className="luminous-world">
        {variant === "server" ? (
          <img
            className="luminous-hero-device"
            src={
              new URL(
                "../../assets/luminous-hero-device-v2.png",
                import.meta.url,
              ).href
            }
            alt=""
            draggable={false}
          />
        ) : (
          <Earth />
        )}
        {variant !== "server" && (
          <svg className="luminous-connection-arcs" viewBox="0 0 600 600">
            {[
              "M85,280 Q260,65 370,265",
              "M120,150 Q300,50 440,205",
              "M205,110 Q300,50 370,265",
              "M370,265 Q525,95 520,320",
              "M370,265 Q470,250 440,430",
              "M85,280 Q300,170 520,320",
            ].map((d, i) => (
              <g key={i}>
                <path d={d} />
                <path
                  d={d}
                  className="luminous-connection-packet"
                  style={{ animationDelay: i * -1.3 + "s" }}
                />
              </g>
            ))}
          </svg>
        )}
        <div className="luminous-orbits">
          {[0, 1, 2].map((i) => (
            <div
              className="luminous-orbit"
              key={i}
              style={{ "--orbit": i } as CSSProperties}
            >
              <i />
              <b />
            </div>
          ))}
        </div>
      </div>
      <div className="luminous-platform">
        <i />
        <i />
        <i />
      </div>
      <div className="luminous-scene-server is-left">
        <ServerSculpture small />
      </div>
      <div className="luminous-scene-server is-right">
        <ServerSculpture small tone="purple" />
      </div>
      <div className="luminous-particles">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
