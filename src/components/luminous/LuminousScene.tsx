import { useEffect, useRef, type CSSProperties } from "react";
import ServerSculpture from "./ServerSculpture";
import { MOTION_EVENT, motionAllowed } from "./motion";

// A ray/sphere intersection shades a real rotating sphere. All resources are
// local; no map service, external texture request or 3D runtime is required.
const vertex =
  "attribute vec2 position; varying vec2 uv; void main(){uv=position;gl_Position=vec4(position,0.,1.);}";
const fragment = `precision mediump float;
varying vec2 uv; uniform sampler2D earth; uniform float angle;
void main(){
 vec2 p=uv*1.12; float r=dot(p,p);
 if(r>1.){float a=exp(-18.*(sqrt(r)-1.))*.38;gl_FragColor=vec4(.25,.68,1.,a);return;}
 vec3 n=vec3(p.x,p.y,sqrt(1.-r));
 float tilt=.18; n.yz=mat2(cos(tilt),-sin(tilt),sin(tilt),cos(tilt))*n.yz;
 vec3 v=n; v.xz=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*n.xz;
 vec2 t=vec2(.5+atan(v.x,v.z)/6.283185,.5-asin(v.y)/3.141593);
 vec3 col=texture2D(earth,t).rgb;
 float land=smoothstep(.42,.7,col.r);
 float grain=sin(t.x*760.)*sin(t.y*590.)*.025;
 col+=grain;
 float light=.46+.54*max(0.,dot(n,normalize(vec3(-.5,.7,1.))));
 col*=light;
 float rim=pow(1.-sqrt(1.-r),2.5);
 col=mix(col,vec3(.7,.94,1.),rim*.8);
 float grid=step(.978,fract(t.x*24.))+step(.978,fract(t.y*12.));
 col+=vec3(.2,.6,1.)*grid*.13;
 float city=pow(max(0.,sin(t.x*1741.)*sin(t.y*2161.)),20.)*land;
 col+=vec3(1.,.85,.48)*city*.65;
 float cloud=sin(t.x*51.+sin(t.y*27.))*sin(t.y*43.+sin(t.x*31.));
 col=mix(col,vec3(.89,.97,1.),smoothstep(.56,.95,cloud)*.26);
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
      angle = 1.7,
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
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const angleLocation = gl.getUniformLocation(program, "angle");
    const draw = () => {
      if (!loaded || disposed || gl.isContextLost()) return;
      const size = Math.max(
        1,
        Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 1.5)),
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
      if (time - last >= 32) {
        angle += Math.min(64, time - last) * 0.000065;
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
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      loaded = true;
      canvas.dataset.renderer = "webgl";
      sync();
    };
    image.onerror = () => {
      canvas.dataset.renderer = "fallback";
      sync();
    };
    image.src = new URL(
      "../../assets/luminous-earth.svg",
      import.meta.url,
    ).href;
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
      image.onload = null;
      image.onerror = null;
      gl.deleteTexture(texture);
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
      <div className="luminous-city">
        {Array.from({ length: 18 }, (_, i) => (
          <i
            key={i}
            style={
              {
                "--i": i,
                "--tower-height": 36 + ((i * 47) % 110) + "px",
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="luminous-world">
        {variant === "server" ? <ServerSculpture /> : <Earth />}
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
