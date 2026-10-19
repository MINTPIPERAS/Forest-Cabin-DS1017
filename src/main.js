import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createEnvironment } from './environment.js';
import { createCabin } from './cabin.js';
import { createForest } from './forest.js';
import { AmbientSound } from './audio.js';
import { groundHeight } from './utils.js';

const host = document.querySelector('#canvas-host');
const loaderStatus = document.querySelector('.loader-status');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const FilmGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uNight;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float aspect = uResolution.x / max(1.0, uResolution.y);

      // A whisper of lens softness towards the corners.
      vec2 aberration = centered * dot(centered, centered) * 0.0016;
      vec3 color;
      color.r = texture2D(tDiffuse, uv + aberration).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - aberration).b;

      // Teal shadows, honeyed highlights.
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = color * vec3(0.90, 1.015, 1.045);
      vec3 lightTint = color * vec3(1.035, 1.005, 0.95);
      color = mix(shadowTint, color, smoothstep(0.08, 0.46, luma));
      color = mix(color, lightTint, smoothstep(0.52, 1.0, luma) * 0.32);
      color = mix(color, color * vec3(0.97, 0.995, 1.025), uNight * 0.12);

      // Gentle matte contrast, preserving the soft blue hour shadows.
      color = (color - 0.5) * 1.035 + 0.5;
      color = max(color, vec3(0.0));

      // Oval vignette.
      vec2 v = vec2(centered.x * (aspect * 0.92), centered.y);
      float vignette = smoothstep(0.84, 0.2, length(v));
      color *= mix(0.74, 1.0, vignette * 0.82 + 0.18);

      // Fine, organic grain that moves slowly enough to feel photographic.
      vec2 grainUV = gl_FragCoord.xy + vec2(uTime * 41.0, uTime * 29.0);
      float grain = hash12(grainUV) - 0.5;
      float grainMask = 0.021 + (1.0 - luma) * 0.013;
      color += grain * grainMask;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `,
};

class SceneApp {
  constructor() {
    this.timeUniform = { value: 0 };
    this.audio = new AmbientSound();
    this.nightTarget = 0;
    this.night = 0;
    this.ready = false;
    this.interacting = false;
    this.lastInteraction = performance.now();
    this.nightUI = false;
    this.intro = {
      active: !reducedMotion,
      start: 0,
      duration: 7.2,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
    };
    this.clock = new THREE.Clock();
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '可拖拽环视的森林木屋三维场景');
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.userData.camera = null;

    this.camera = new THREE.PerspectiveCamera(
      41.5,
      window.innerWidth / window.innerHeight,
      0.1,
      300
    );
    this.scene.userData.camera = this.camera;

    this.groundY = groundHeight(0, 0);
    this.target = new THREE.Vector3(0.1, this.groundY + 2.22, 0.5);
    const startAspect = window.innerWidth / window.innerHeight;
    this.portraitScale = startAspect < 0.7 ? 1.25 : startAspect < 1 ? 1.12 : 1;
    this.homeOffset = new THREE.Vector3(9.1, 2.13, 19.5).multiplyScalar(this.portraitScale);
    this.camera.position.copy(this.target).add(this.homeOffset);

    this.environment = createEnvironment(this.scene, this.renderer);

    this.cabin = createCabin(this.renderer);
    this.cabin.position.y = this.groundY - 0.035;
    this.cabin.rotation.y = -0.025;
    this.scene.add(this.cabin);
    this.scene.updateMatrixWorld(true);

    const smokeOrigin = this.cabin.userData.smokeOrigin.clone();
    this.cabin.localToWorld(smokeOrigin);
    this.forest = createForest(
      this.scene,
      this.timeUniform,
      this.environment.pathCurve,
      smokeOrigin
    );

    this.baseCabinLightValues = {
      porch: this.cabin.userData.lights.porch.intensity,
      lantern: this.cabin.userData.lights.lantern.intensity,
      interior: this.cabin.userData.lights.interior.map((light) => light.intensity),
    };

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 8.5;
    this.controls.maxDistance = 29;
    this.controls.minPolarAngle = 0.92;
    this.controls.maxPolarAngle = 1.555;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.075;
    this.controls.zoomSpeed = 0.65;
    this.controls.rotateSpeed = 0.48;
    this.controls.enabled = !this.intro.active;
    this.controls.update();

    if (this.intro.active) {
      const introOffset = new THREE.Vector3(10.0, 2.53, 21.6).multiplyScalar(this.portraitScale);
      this.intro.from.copy(this.target).add(introOffset);
      this.intro.to.copy(this.camera.position);
      this.camera.position.copy(this.intro.from);
      this.camera.lookAt(this.target);
    }

    this.controls.addEventListener('start', this.onControlStart.bind(this));
    this.controls.addEventListener('end', this.onControlEnd.bind(this));
    this.renderer.domElement.addEventListener('pointerdown', this.skipIntro.bind(this), { passive: true });
    this.renderer.domElement.addEventListener('wheel', this.skipIntro.bind(this), { passive: true });

    this.setupPost();
    this.bindUI();
    this.resize();
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.clock.getDelta();
    });

    // The world is static and only the camera moves: bake the shadow pass once.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    if (typeof window !== 'undefined') {
      window.__mistwood = {
        scene: this.scene,
        camera: this.camera,
        renderer: this.renderer,
        controls: this.controls,
        app: this,
      };
    }
  }

  setupPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    const samples = this.renderer.capabilities.isWebGL2
      ? Math.min(4, this.renderer.capabilities.maxSamples || 4)
      : 0;
    this.composer.renderTarget1.samples = samples;
    this.composer.renderTarget2.samples = samples;

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.44,
      0.7,
      0.78
    );
    this.composer.addPass(this.bloom);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.filmPass = new ShaderPass(FilmGradeShader);
    this.filmPass.material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    this.composer.addPass(this.filmPass);

    this.filmPass.material.uniforms.uNight.value = 0;
  }

  bindUI() {
    this.soundButton = document.querySelector('#sound-toggle');
    this.nightButton = document.querySelector('#night-toggle');
    this.fullscreenButton = document.querySelector('#fullscreen-toggle');
    this.statusTime = document.querySelector('#status-time');
    this.statusWeather = document.querySelector('#status-weather');
    this.sceneTagline = document.querySelector('#scene-tagline');

    this.noteLabels = document.querySelectorAll('.interaction-note span');

    this.soundButton.addEventListener('click', async () => {
      this.soundButton.disabled = true;
      try {
        const enabled = await this.audio.toggle();
        document.body.classList.toggle('sound-on', enabled);
        this.soundButton.setAttribute('aria-pressed', String(enabled));
        this.soundButton.setAttribute('aria-label', enabled ? '关闭环境声' : '开启环境声');
        this.soundButton.dataset.tooltip = enabled ? '环境声 · 开' : '环境声 · 关';
        this.audio.setNight(this.nightTarget);
      } catch (error) {
        console.warn('Ambient audio unavailable:', error);
        this.soundButton.dataset.tooltip = '此浏览器不支持环境声';
      } finally {
        this.soundButton.disabled = false;
      }
    });

    this.nightButton.addEventListener('click', () => {
      this.nightTarget = this.nightTarget > 0.5 ? 0 : 1;
      const night = this.nightTarget > 0.5;
      document.body.classList.toggle('night-mode', night);
      this.nightButton.setAttribute('aria-pressed', String(night));
      this.nightButton.setAttribute('aria-label', night ? '切换回黄昏' : '切换到深夜');
      this.nightButton.dataset.tooltip = night ? '回到黄昏' : '点亮夜色';
      this.statusTime.textContent = night ? '23:16' : '18:42';
      this.statusWeather.textContent = night
        ? '星夜 · 无风 · 4°C'
        : '薄雾 · 西南风 2 级 · 7°C';
      if (this.sceneTagline) {
        this.sceneTagline.textContent = night
          ? '夜色落满松林，木屋里还留着一盏灯。'
          : '暮色漫过松针，木屋里煨着一盏黄昏。';
      }
      this.audio.setNight(this.nightTarget);
    });

    this.fullscreenButton.addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch (error) {
        console.warn('Fullscreen unavailable:', error);
        this.fullscreenButton.dataset.tooltip = '浏览器未允许全屏';
      }
    });
    document.addEventListener('fullscreenchange', () => {
      const isFull = Boolean(document.fullscreenElement);
      document.body.classList.toggle('is-fullscreen', isFull);
      this.fullscreenButton.setAttribute('aria-label', isFull ? '退出全屏' : '进入全屏');
      this.fullscreenButton.dataset.tooltip = isFull ? '退出全屏' : '全屏';
    });

    document.querySelectorAll('a[href="#"]').forEach((a) => {
      a.addEventListener('click', (event) => event.preventDefault());
    });
  }

  skipIntro() {
    if (!this.intro.active) return;
    this.intro.active = false;
    this.camera.position.copy(this.intro.to);
    this.controls.target.copy(this.target);
    this.controls.enabled = true;
    this.controls.update();
    this.lastInteraction = performance.now();
  }

  onControlStart() {
    this.skipIntro();
    this.interacting = true;
    this.controls.autoRotate = false;
    host.classList.add('is-dragging');
  }

  onControlEnd() {
    this.interacting = false;
    this.lastInteraction = performance.now();
    host.classList.remove('is-dragging');
  }

  reveal() {
    this.ready = true;
    this.clock.start();
    this.intro.start = performance.now();
    this.lastInteraction = performance.now();
    document.body.classList.add('scene-ready');
    document.body.classList.toggle('night-mode', this.nightTarget > 0.5);
    this.animate();
  }

  animate() {
    requestAnimationFrame(this.frame);
  }

  frame() {
    const delta = Math.min(this.clock.getDelta(), 0.06);
    const time = this.clock.elapsedTime;
    this.timeUniform.value = time;
    const now = performance.now();

    const nightEase = 1 - Math.exp(-delta * 1.45);
    this.night += (this.nightTarget - this.night) * nightEase;
    if (Math.abs(this.night - this.nightTarget) < 0.0008) this.night = this.nightTarget;

    this.environment.setNight(this.night);
    this.environment.update(time, delta);
    this.forest.setNight(this.night);
    this.forest.update();
    this.audio.setNight(this.night);

    const cabinLights = this.cabin.userData.lights;
    const hearthFlicker =
      1 + Math.sin(time * 2.3) * 0.013 + Math.sin(time * 6.1 + 1.2) * 0.009;
    cabinLights.porch.intensity =
      this.baseCabinLightValues.porch * (1 + this.night * 0.34) * hearthFlicker;
    cabinLights.lantern.intensity =
      this.baseCabinLightValues.lantern * (1 + this.night * 0.45) * (2 - hearthFlicker);
    cabinLights.interior.forEach((light, index) => {
      const phase = 1 + Math.sin(time * 1.7 + index * 1.8) * 0.01;
      light.intensity = this.baseCabinLightValues.interior[index] * (1 + this.night * 0.22) * phase;
    });
    this.cabin.userData.material.glass.color.setRGB(
      1.72 + this.night * 0.52,
      1.12 + this.night * 0.3,
      0.6 + this.night * 0.15
    );
    this.bloom.strength = 0.44 + this.night * 0.13;
    this.filmPass.material.uniforms.uNight.value = this.night;

    if (this.intro.active) {
      const t = Math.min(1, (now - this.intro.start) / (this.intro.duration * 1000));
      const eased = 1 - Math.pow(1 - t, 4);
      this.camera.position.lerpVectors(this.intro.from, this.intro.to, eased);
      this.camera.lookAt(this.target);
      this.controls.target.copy(this.target);
      if (t >= 1) {
        this.intro.active = false;
        this.controls.enabled = true;
        this.lastInteraction = now;
      }
    } else {
      const idleFor = now - this.lastInteraction;
      this.controls.autoRotate =
        !reducedMotion && !this.interacting && idleFor > 22000;
      this.controls.update();
    }

    this.filmPass.material.uniforms.uTime.value = time;
    this.composer.render();
    this.animate();
  }

  resize() {
    if (!this.renderer) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Portrait screens get a slightly wider field on top of the pulled-back home view.
    this.camera.fov = aspect < 1 ? 50 : 41.5;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.filmPass.material.uniforms.uResolution.value.set(width, height);
    this.environment.sky.position.copy(this.camera.position);

    if (this.noteLabels) {
      const compact = width <= 760 || window.matchMedia('(pointer: coarse)').matches;
      if (this.noteLabels[1]) this.noteLabels[1].textContent = compact ? '滑动环视' : '拖动环视';
      if (this.noteLabels[2]) this.noteLabels[2].textContent = compact ? '双指缩放' : '滚轮靠近';
    }
  }
}

async function boot() {
  // Background tabs can pause requestAnimationFrame indefinitely, so the
  // startup sequence must also be able to advance on a timer.
  const nextTick = () =>
    new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 90);
    });

  // Let the loader and the first paint exist before the synchronous world build.
  await nextTick();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 220));

  const app = new SceneApp();
  window.__bootStage = 'constructed';
  try {
    app.init();
    window.__bootStage = 'initialised';
    // Compile materials and bake the first shadow map before lifting the veil.
    app.composer.render();
    if (document.fonts?.ready) {
      await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1200))]);
    }
    await new Promise((resolve) => setTimeout(resolve, 520));
    // requestAnimationFrame may be throttled in a background tab; the loader
    // should still lift once the world is ready.
    setTimeout(() => {
      if (!app.ready) app.reveal();
    }, 400);
    requestAnimationFrame(() => app.reveal());
  } catch (error) {
    console.error(error);
    if (loaderStatus) {
      loaderStatus.textContent = '场景未能载入，请确认浏览器支持 WebGL 2。';
      loaderStatus.style.color = 'rgba(231, 197, 155, 0.8)';
    }
  }
}

boot();
