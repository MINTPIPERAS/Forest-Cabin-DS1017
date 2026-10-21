import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { createEnvironment } from './environment.js?v=4';
import { createCabin } from './cabin.js';
import { createForest } from './forest.js';
import { createLake } from './lake.js';
import { createWeather } from './weather.js';
import { AmbientSound } from './audio.js';
import { COPY } from './copy.js';
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
    this.snowUniform = { value: 0 };
    this.audio = new AmbientSound();
    this.timeOfDay = 'dusk';
    this.weatherKey = 'clear';
    this.ready = false;
    this.interacting = false;
    this.immersive = false;
    this.lastInteraction = performance.now();
    this.intro = {
      active: !reducedMotion,
      start: 0,
      duration: 7.6,
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
    // Supersample: render above CSS resolution so thin geometry (needles,
    // railings, window mullions) stays crisp instead of shimmering.
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr * 1.5, 2.0));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '可拖拽环视的森林湖畔木屋三维场景');
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.userData.camera = null;

    this.camera = new THREE.PerspectiveCamera(
      44,
      window.innerWidth / window.innerHeight,
      0.1,
      320
    );
    this.scene.userData.camera = this.camera;

    this.groundY = groundHeight(0, 0);
    // Aim between the cabin and the lake so both sit in the frame.
    this.target = new THREE.Vector3(1.2, this.groundY + 1.2, 12.0);
    const startAspect = window.innerWidth / window.innerHeight;
    this.portraitScale = startAspect < 0.7 ? 1.34 : startAspect < 1 ? 1.16 : 1;
    // A raised, pulled-back vantage that reveals the lake, dock and treeline.
    this.homeOffset = new THREE.Vector3(7.8, 13.2, 24.0).multiplyScalar(this.portraitScale);
    this.camera.position.copy(this.target).add(this.homeOffset);

    this.environment = createEnvironment(this.scene, this.renderer, {
      snowUniform: this.snowUniform,
    });

    this.cabin = createCabin(this.renderer, { snowUniform: this.snowUniform });
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
      smokeOrigin,
      { snowUniform: this.snowUniform }
    );
    this.lake = createLake(this.scene, this.timeUniform);
    this.weather = createWeather(this.scene);

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
    this.controls.minDistance = 12;
    this.controls.maxDistance = 46;
    this.controls.minPolarAngle = 0.55;
    this.controls.maxPolarAngle = 1.5;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.06;
    this.controls.zoomSpeed = 0.65;
    this.controls.rotateSpeed = 0.42;
    this.controls.enabled = !this.intro.active;
    this.controls.update();

    if (this.intro.active) {
      const introOffset = new THREE.Vector3(9.6, 12.8, 26.5).multiplyScalar(this.portraitScale);
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
    this.applyCopy();
    this.bindUI();
    this.resize();
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.clock.getDelta();
    });

    // The world is static and only the camera moves: bake the shadow pass once.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.applyTimeOfDay(this.timeOfDay, { instant: true });
    this.applyWeather(this.weatherKey, { instant: true });

    if (typeof window !== 'undefined') {
      window.__mistwood = {
        THREE,
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
    // MSAA on the scene targets: FXAA alone leaves small emissive shapes (lamp
    // bulbs, window frames) looking blocky and unstable while the camera moves.
    const samples = this.renderer.capabilities.isWebGL2
      ? Math.min(4, this.renderer.capabilities.maxSamples || 4)
      : 0;
    this.composer.renderTarget1.samples = samples;
    this.composer.renderTarget2.samples = samples;

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Bloom at full resolution: a half-res blur turns small warm lights into
    // blocky halos that visibly pop while the camera moves.
    const bloomSize = new THREE.Vector2(
      window.innerWidth * this.renderer.getPixelRatio(),
      window.innerHeight * this.renderer.getPixelRatio()
    );
    this.bloom = new UnrealBloomPass(bloomSize, 0.44, 0.7, 0.78);
    this.composer.addPass(this.bloom);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.filmPass = new ShaderPass(FilmGradeShader);
    this.filmPass.material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    this.composer.addPass(this.filmPass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);
    this.resizeFxaa(window.innerWidth, window.innerHeight);
  }

  resizeFxaa(width, height) {
    if (!this.fxaaPass) return;
    const ratio = this.renderer.getPixelRatio();
    const uniforms = this.fxaaPass.material.uniforms;
    if (uniforms.resolution) {
      uniforms.resolution.value.set(1 / (width * ratio), 1 / (height * ratio));
    }
  }

  applyCopy() {
    document.title = COPY.siteTitle;
    const byKey = {
      brandSub: COPY.brandSub,
      eyebrow: COPY.eyebrow,
      heroTitleMain: COPY.heroTitleMain,
      heroTitleAccent: COPY.heroTitleAccent,
      hintOrbit: COPY.hints.orbitDesktop,
      hintZoom: COPY.hints.zoomDesktop,
      immersiveHint: COPY.immersiveHint,
      loaderKicker: COPY.loaderKicker,
      loaderTitle: COPY.loaderTitle,
      loaderStatus: COPY.loaderStatus,
      loaderFoot: COPY.loaderFoot,
    };
    for (const el of document.querySelectorAll('[data-copy]')) {
      const value = byKey[el.dataset.copy];
      if (value) el.textContent = value;
    }
  }

  bindUI() {
    this.soundButton = document.querySelector('#sound-toggle');
    this.fullscreenButton = document.querySelector('#fullscreen-toggle');
    this.immersiveButton = document.querySelector('#immersive-toggle');
    this.statusTime = document.querySelector('#status-time');
    this.statusWeather = document.querySelector('#status-weather');
    this.sceneTagline = document.querySelector('#scene-tagline');
    this.timeButtons = [...document.querySelectorAll('[data-time]')];
    this.weatherButtons = [...document.querySelectorAll('[data-weather]')];
    this.noteLabels = document.querySelectorAll('.interaction-note span');

    this.soundButton.addEventListener('click', async () => {
      this.soundButton.disabled = true;
      try {
        const enabled = await this.audio.toggle();
        document.body.classList.toggle('sound-on', enabled);
        this.soundButton.setAttribute('aria-pressed', String(enabled));
        this.soundButton.setAttribute('aria-label', enabled ? '关闭环境声' : '开启环境声');
        this.soundButton.dataset.tooltip = enabled ? COPY.tooltips.soundOn : COPY.tooltips.soundOff;
        this.audio.setNight(this.environment.state.night);
      } catch (error) {
        console.warn('Ambient audio unavailable:', error);
        this.soundButton.dataset.tooltip = '此浏览器不支持环境声';
      } finally {
        this.soundButton.disabled = false;
      }
    });

    for (const button of this.timeButtons) {
      button.addEventListener('click', () => this.applyTimeOfDay(button.dataset.time));
    }
    for (const button of this.weatherButtons) {
      button.addEventListener('click', () => this.applyWeather(button.dataset.weather));
    }

    if (this.immersiveButton) {
      this.immersiveButton.addEventListener('click', () => this.toggleImmersive());
    }
    window.addEventListener('keydown', (event) => {
      if (event.key === 'h' || event.key === 'H') {
        const target = event.target;
        const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
        if (!typing) {
          event.preventDefault();
          this.toggleImmersive();
        }
      } else if (event.key === 'Escape' && this.immersive) {
        this.toggleImmersive(false);
      }
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
      this.fullscreenButton.dataset.tooltip = isFull ? COPY.tooltips.fullscreenExit : COPY.tooltips.fullscreen;
    });

    document.querySelectorAll('a[href="#"]').forEach((a) => {
      a.addEventListener('click', (event) => event.preventDefault());
    });
  }

  toggleImmersive(force) {
    const next = typeof force === 'boolean' ? force : !this.immersive;
    if (next === this.immersive) return;
    this.immersive = next;
    document.body.classList.toggle('immersive', next);
    if (this.immersiveButton) {
      this.immersiveButton.setAttribute('aria-pressed', String(next));
      this.immersiveButton.setAttribute('aria-label', next ? '退出沉浸模式' : '进入沉浸模式');
      this.immersiveButton.dataset.tooltip = next ? COPY.tooltips.immersiveExit : COPY.tooltips.immersive;
    }
    // Immersive mode pairs naturally with a slow cinematic drift.
    this.lastInteraction = performance.now();
    if (next && !reducedMotion) this.controls.autoRotate = false;
  }

  applyTimeOfDay(key, { instant = false } = {}) {
    if (!this.environment.presets.time[key]) return;
    this.timeOfDay = key;
    this.environment.setTime(key);
    for (const button of this.timeButtons) {
      const active = button.dataset.time === key;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    }
    document.body.dataset.time = key;
    document.body.classList.toggle('night-mode', key === 'night');

    const clock = COPY.times[key];
    if (this.statusTime) this.statusTime.textContent = clock;

    const taglines = COPY.taglines;
    if (this.sceneTagline) this.sceneTagline.textContent = taglines[key];
    this.updateWeatherStatus();
    if (instant) this.environment.update(this.clock.elapsedTime, 0.016);
  }

  applyWeather(key, { instant = false } = {}) {
    if (!this.environment.presets.weather[key]) return;
    this.weatherKey = key;
    this.environment.setWeather(key);
    this.weather.setWeather(this.environment.presets.weather[key]);
    for (const button of this.weatherButtons) {
      const active = button.dataset.weather === key;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    }
    document.body.dataset.weather = key;
    this.updateWeatherStatus();
    if (instant) this.environment.update(this.clock.elapsedTime, 0.016);
  }

  updateWeatherStatus() {
    if (!this.statusWeather) return;
    this.statusWeather.textContent = COPY.weatherLabels[this.weatherKey][this.timeOfDay];
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
    this.applyTimeOfDay(this.timeOfDay);
    this.applyWeather(this.weatherKey);
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

    this.environment.update(time, delta);
    const env = this.environment.state;
    const night = env.night;
    const day = env.day;
    const lamp = env.lampFactor;

    this.forest.setNight(night);
    this.forest.update();
    this.lake.setTimeOfDay(this.environment.presets.time[this.timeOfDay]);
    this.lake.setWeather({
      rain: env.rain,
      snow: env.snow,
      wind: env.wind,
      fogDensity: env.fogDensity,
      fogColor: this.scene.fog.color,
      lampIntensity: lamp,
    });
    this.lake.update(time, this.camera, night, env);
    this.weather.update(time, this.camera);
    this.audio.setNight(night);

    const cabinLights = this.cabin.userData.lights;
    const hearthFlicker =
      1 + Math.sin(time * 2.3) * 0.013 + Math.sin(time * 6.1 + 1.2) * 0.009;
    cabinLights.porch.intensity =
      this.baseCabinLightValues.porch * (1 + night * 0.34) * lamp * hearthFlicker;
    cabinLights.lantern.intensity =
      this.baseCabinLightValues.lantern * (1 + night * 0.45) * lamp * (2 - hearthFlicker);
    cabinLights.interior.forEach((light, index) => {
      const phase = 1 + Math.sin(time * 1.7 + index * 1.8) * 0.01;
      light.intensity =
        this.baseCabinLightValues.interior[index] * (1 + night * 0.22) * lamp * phase;
    });
    this.cabin.userData.material.glass.color.setRGB(
      0.62 + night * 1.62 + day * 0.12,
      0.44 + night * 0.98 + day * 0.08,
      0.26 + night * 0.49 + day * 0.05
    );
    const preset = this.environment.presets.time[this.timeOfDay];
    this.bloom.strength = preset.bloom + night * 0.05;
    this.filmPass.material.uniforms.uNight.value = night;

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
    this.updateDynamicResolution(delta, now);
    this.animate();
  }

  /**
   * Dynamic resolution: keep the frame rate healthy without visibly softening
   * the image. The floor is 1.0 (never below CSS pixel density), it only steps
   * down when genuinely struggling, and it waits much longer between changes so
   * bloom never flickers as the render target is resized.
   */
  updateDynamicResolution(delta, now) {
    if (!this.ready) return;
    if (this.drLastAdjust === undefined) {
      this.drLastAdjust = now;
      this.drFrames = 0;
      this.drAccum = 0;
      // Floor is the device's own density: never render below 1:1 CSS pixels.
      // Ceiling keeps the supersample started in init().
      this.drMin = Math.min(window.devicePixelRatio || 1, 1.5);
      this.drMax = Math.min((window.devicePixelRatio || 1) * 1.5, 2.0);
      this.drCurrent = this.renderer.getPixelRatio();
      return;
    }
    this.drFrames++;
    this.drAccum += delta;
    const windowMs = 3500;
    if (now - this.drLastAdjust < windowMs) return;
    const avg = this.drAccum / Math.max(1, this.drFrames);
    this.drAccum = 0;
    this.drFrames = 0;
    this.drLastAdjust = now;

    // Ignore long stalls (tab switches, shader compile) rather than reacting.
    if (avg > 0.25) return;

    // Hysteresis: only shrink after a sustained slow stretch, and require a
    // much better frame time to grow. This keeps the supersample stable
    // instead of oscillating every few seconds.
    this.drSlowStreak = avg > 1 / 26 ? (this.drSlowStreak || 0) + 1 : 0;

    let next = this.drCurrent;
    if (this.drSlowStreak >= 2) {
      next = Math.max(this.drMin, this.drCurrent - 0.1);
      this.drSlowStreak = 0;
    } else if (avg < 1 / 45 && this.drCurrent < this.drMax) {
      next = Math.min(this.drMax, this.drCurrent + 0.1);
    }
    if (Math.abs(next - this.drCurrent) < 0.01) return;
    this.drCurrent = next;
    this.renderer.setPixelRatio(next);
    this.composer.setPixelRatio(next);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.composer.setSize(width, height);
    this.renderer.setSize(width, height);
    this.bloom.setSize(
      Math.max(1, Math.round((width * next) / 2)),
      Math.max(1, Math.round((height * next) / 2))
    );
    this.resizeFxaa(width, height);
  }

  resize() {
    if (!this.renderer) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Portrait screens get a slightly wider field on top of the pulled-back home view.
    this.camera.fov = aspect < 1 ? 52 : 44;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    // Bloom at full device resolution: half-res blur makes small warm lights
    // (lanterns, window lamps) pop into blocky squares while the camera moves.
    const pixelRatio = this.renderer.getPixelRatio();
    this.bloom.setSize(width * pixelRatio, height * pixelRatio);
    this.resizeFxaa(width, height);
    this.filmPass.material.uniforms.uResolution.value.set(width, height);
    this.environment.sky.position.copy(this.camera.position);

    if (this.noteLabels) {
      const compact = width <= 760 || window.matchMedia('(pointer: coarse)').matches;
      if (this.noteLabels[1]) this.noteLabels[1].textContent = compact ? COPY.hints.orbitTouch : COPY.hints.orbitDesktop;
      if (this.noteLabels[2]) this.noteLabels[2].textContent = compact ? COPY.hints.zoomTouch : COPY.hints.zoomDesktop;
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
      loaderStatus.textContent = `场景载入出错：${error?.message || error}`;
      loaderStatus.style.color = 'rgba(231, 197, 155, 0.85)';
    }
    if (window.__mistwoodReport) window.__mistwoodReport(String(error?.message || error), error?.stack);
  }
}

boot();
