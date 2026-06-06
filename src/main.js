import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from '@studio-freight/lenis';
import { ParticleModelSystem } from './particleSystem.js';

gsap.registerPlugin(ScrollTrigger);

// 1. Smooth Scroll Setup on Custom Snapping Container
const scrollContainer = document.querySelector('#scroll-container');
const lenis = new Lenis({
  wrapper: scrollContainer,
  content: scrollContainer,
  duration: 1.2,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
});
gsap.ticker.lagSmoothing(0, 0);

// 2. Three.js Setup
const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();

const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
};

const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 100);
camera.position.z = 8;
scene.add(camera);

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  alpha: true,
  antialias: true,
});
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// 3. Earth Material (Custom Shader)
const textureLoader = new THREE.TextureLoader();
const earthDayTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg');
const earthNightTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_lights_2048.png');

const geometry = new THREE.SphereGeometry(2, 64, 64);

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform sampler2D uDayTexture;
  uniform sampler2D uNightTexture;
  uniform vec3 uGlowColor;
  uniform float uFadeProgress;
  uniform float uDayNightTransition; // 0.0 = full night, 1.0 = directional sunlight

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec4 dayColor = texture2D(uDayTexture, vUv);
    vec4 nightColor = texture2D(uNightTexture, vUv);
    
    // Simulate directional light (sun)
    vec3 sunDir = normalize(vec3(1.0, 0.5, 1.0));
    float lightIntensity = dot(normalize(vNormal), sunDir);
    float smoothLight = smoothstep(-0.2, 0.2, lightIntensity);
    
    // Cor azul super escuro (Base da Terra na imagem)
    vec3 exactNightColor = vec3(0.02, 0.03, 0.07);
    
    // Intro State (uDayNightTransition = 0.0)
    vec3 introColor = exactNightColor + (nightColor.rgb * 0.3);
    
    // Normal State (uDayNightTransition = 1.0)
    vec3 normalColor = mix(nightColor.rgb * 0.5, dayColor.rgb, smoothLight);
    
    // Transição suave entre Intro e Normal
    vec3 earthColor = mix(introColor, normalColor, uDayNightTransition);
    
    // Fresnel glow on the rim (using view direction)
    vec3 viewDir = normalize(vViewPosition);
    float intensity = 1.0 - max(dot(normalize(vNormal), viewDir), 0.0);
    
    // Linha cyan fininha na borda (Rim Light) - agora muito mais sutil e discreta
    float rimPower = mix(45.0, 20.0, uDayNightTransition);
    float rimMultiplier = mix(0.8, 0.4, uDayNightTransition);
    float rimLight = pow(intensity, rimPower) * rimMultiplier;
    
    vec3 glow = uGlowColor * rimLight;

    // Mix to solid black based on fade progress
    vec3 baseColor = mix(earthColor, vec3(0.0), uFadeProgress);

    gl_FragColor = vec4(baseColor + glow, 1.0);
  }
`;

// Atmosphere Shaders
const atmosVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const atmosFragmentShader = `
  uniform vec3 uGlowColor;
  uniform float uDayNightTransition;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = 1.0 - max(dot(normalize(vNormal), viewDir), 0.0);
    
    // Contorno brilhante e nítido (sharp rim)
    float thinLine = pow(fresnel, 50.0) * 1.5;
    float softHalo = pow(fresnel, 15.0) * 0.3;
    float alpha = (thinLine + softHalo) * uIntensity;
    
    alpha = mix(alpha, alpha * 0.3, uDayNightTransition);
    gl_FragColor = vec4(uGlowColor, alpha);
  }
`;

// =========================================================================
// O BRILHO GIGANTE DIRETAMENTE NO 3D (MATEMÁTICA CIRÚRGICA)
// =========================================================================
const glowSpriteSize = 7.0;
const glowCanvas = document.createElement('canvas');
glowCanvas.width = 2048;
glowCanvas.height = 2048;
const context = glowCanvas.getContext('2d');

const earthRadiusInCanvas = (4.0 / glowSpriteSize) * 1024;
const innerRadius = earthRadiusInCanvas * 0.45;

const glowGradient = context.createRadialGradient(1024, 1024, innerRadius, 1024, 1024, 1024);

glowGradient.addColorStop(0, 'rgba(0, 160, 220, 0.22)');
glowGradient.addColorStop(0.2, 'rgba(0, 130, 200, 0.18)');
glowGradient.addColorStop(0.4, 'rgba(0, 100, 180, 0.12)');
glowGradient.addColorStop(0.45, 'rgba(0, 90, 170, 0.09)');
glowGradient.addColorStop(0.6, 'rgba(0, 50, 120, 0.04)');
glowGradient.addColorStop(0.75, 'rgba(0, 20, 60, 0.01)');
glowGradient.addColorStop(0.9, 'rgba(0, 5, 20, 0.003)');
glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

context.fillStyle = glowGradient;
context.fillRect(0, 0, 2048, 2048);

const glowTexture = new THREE.CanvasTexture(glowCanvas);
const glowMaterial = new THREE.SpriteMaterial({
  map: glowTexture,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

// =========================================================================
// EFEITO DE NÉVOA DE FUNDO (LIMITADO À CURVATURA DA TERRA)
// =========================================================================
const fogSpriteSize = 8.0;
const fogCanvas = document.createElement('canvas');
fogCanvas.width = 1024;
fogCanvas.height = 1024;
const fogContext = fogCanvas.getContext('2d');

const fogGradient = fogContext.createRadialGradient(512, 512, 220, 512, 512, 400);

fogGradient.addColorStop(0, 'rgba(0, 100, 150, 0.08)');
fogGradient.addColorStop(0.2, 'rgba(0, 80, 140, 0.06)');
fogGradient.addColorStop(0.5, 'rgba(0, 40, 90, 0.025)');
fogGradient.addColorStop(0.8, 'rgba(0, 15, 50, 0.006)');
fogGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

fogContext.fillStyle = fogGradient;
fogContext.fillRect(0, 0, 1024, 1024);

const fogTexture = new THREE.CanvasTexture(fogCanvas);
const fogMaterial = new THREE.SpriteMaterial({
  map: fogTexture,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
// ===========================================// Create 4 Earth Groups
const earths = [];
const atmosMats = [];
const earthGroups = [];
const glowSprites = [];
const fogSprites = [];

for (let i = 0; i < 4; i++) {
  const group = new THREE.Group();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDayTexture: { value: earthDayTexture },
      uNightTexture: { value: earthNightTexture },
      uGlowColor: { value: new THREE.Color('#00aaff') },
      uFadeProgress: { value: 0.0 },
      uDayNightTransition: { value: 0.0 },
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new THREE.Mesh(geometry, mat);
  group.add(mesh);
  
  // Atmosphere Mesh (Linha fina e delicada)
  const atmosMat = new THREE.ShaderMaterial({
    uniforms: {
      uGlowColor: { value: new THREE.Color('#2299ff') },
      uDayNightTransition: { value: 0.0 },
      uIntensity: { value: 1.0 }
    },
    vertexShader: atmosVertexShader,
    fragmentShader: atmosFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const atmosMesh = new THREE.Mesh(geometry, atmosMat);
  atmosMesh.scale.set(1.012, 1.012, 1.012);
  group.add(atmosMesh);
  
  // Halo de luz principal (Glow Sprite)
  const glowSprite = new THREE.Sprite(glowMaterial);
  glowSprite.scale.set(glowSpriteSize, glowSpriteSize, 1.0);
  glowSprite.position.z = -0.1;
  group.add(glowSprite);
  glowSprites.push(glowSprite);

  // Névoa de fundo (Fog Sprite)
  const fogSprite = new THREE.Sprite(fogMaterial);
  fogSprite.scale.set(fogSpriteSize, fogSpriteSize, 1.0); 
  fogSprite.position.z = -0.2;
  group.add(fogSprite);
  fogSprites.push(fogSprite);
  
  // Terra menor (círculo mais compacto)
  group.position.set(0, -7.0, 0);
  group.scale.set(3.0, 3.0, 3.0);
  
  group.rotation.x = 0.0;
  group.rotation.y = 1.8; // Inicializa apontando para o Brasil
  group.rotation.z = 0.0;
  
  if (i > 0) {
    group.position.z = -0.01 * i;
  }
  
  scene.add(group);
  earths.push(mesh);
  atmosMats.push(atmosMat);
  earthGroups.push(group);
}

// =========================================================================
// 4. SISTEMA DE PARTÍCULAS — Carregar modelos GLB e inicializar
// =========================================================================
const particleSystem = new ParticleModelSystem(scene, camera, renderer);

// Estado do morphing controlado pelo scroll
const morphState = {
  fromIndex: 0,
  toIndex: 0,
  progress: 0.0,
  opacity: 0.0,
  scrollProgress: 0.0,
  _lastFrom: -1,
  _lastTo: -1,
};

// URLs dos modelos
const modelURLs = [
  '/models/airplane.glb',
  '/models/energy16.glb',
  '/models/rocket.glb',
  '/models/datacenter.glb',
];

// Carregar modelos e construir timeline GSAP depois
particleSystem.init(modelURLs).then(() => {
  console.log('[Main] Particle system ready, building GSAP timeline...');
  particleSystem.setMorphTargets(0, 0);
  buildGSAPTimeline();
}).catch(err => {
  console.error('[Main] Failed to init particle system:', err);
  // Build timeline anyway (Earth animations still work)
  buildGSAPTimeline();
});

// =========================================================================
// 5. GSAP Timeline (construída após modelos carregarem)
// =========================================================================
function buildGSAPTimeline() {
  ScrollTrigger.defaults({
    scroller: "#scroll-container"
  });

  const rotationParams = {
    offset: 1.8,
    autoSpin: 1.0
  };

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: "#sec-hero",
      endTrigger: "#sec-footer",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    }
  });

  // ── Passo 0→1: Hero → Hero Centered ────────────────────────────────
  tl.to(earthGroups.map(g => g.position), {
    y: -0.7,
    x: 0.0,
    duration: 1,
    ease: "power1.inOut"
  }, 0)
  .to(earthGroups.map(g => g.scale), {
    x: 1.1,
    y: 1.1,
    z: 1.1,
    duration: 1,
    ease: "power1.inOut"
  }, 0)
  .to(earths.map(e => e.material.uniforms.uDayNightTransition), {
    value: 1.0,
    duration: 1,
    ease: "power1.inOut"
  }, 0)
  .to(atmosMats.map(m => m.uniforms.uDayNightTransition), {
    value: 1.0,
    duration: 1,
    ease: "power1.inOut"
  }, 0)
  .to([glowMaterial, fogMaterial], {
    opacity: 0.0,
    duration: 1,
    ease: "power1.inOut"
  }, 0)
  .to(rotationParams, {
    offset: 1.8,
    autoSpin: 0.1,
    duration: 1,
    ease: "power1.inOut"
  }, 0)
  .to("#scroll-arrow", {
    opacity: 0,
    duration: 0.5,
    ease: "power1.inOut"
  }, 0);

  // ── Passo 1→2: Hero Centered → One Vision ──────────────────────────
  tl.to(earthGroups.map(g => g.position), {
    y: 0.5,
    duration: 1,
    ease: "power1.inOut"
  }, 1)
  .to(earthGroups.map(g => g.scale), {
    x: 0.5,
    y: 0.5,
    z: 0.5,
    duration: 1,
    ease: "power1.inOut"
  }, 1)
  .to(earths.map(e => e.material.uniforms.uFadeProgress), {
    value: 1.0,
    duration: 1,
    ease: "power1.inOut"
  }, 1)
  .to(earths.map(e => e.material.uniforms.uDayNightTransition), {
    value: 0.0,
    duration: 1,
    ease: "power1.inOut"
  }, 1)
  .to(atmosMats.map(m => m.uniforms.uDayNightTransition), {
    value: 0.0,
    duration: 1,
    ease: "power1.inOut"
  }, 1)
  .to(atmosMats.map(m => m.uniforms.uIntensity), {
    value: 1.0,
    duration: 1,
    ease: "power1.inOut"
  }, 1)
  .to([glowMaterial, fogMaterial], {
    opacity: 1.0,
    duration: 1,
    ease: "power1.inOut"
  }, 1)
  .to(rotationParams, {
    offset: 3.5,
    autoSpin: 0.0,
    duration: 1,
    ease: "power1.inOut"
  }, 1);

  // ── Passo 2→3: One Vision → Four Horizons ──────────────────────────
  const targetX = [-2.4, -0.8, 0.8, 2.4];
  earthGroups.forEach((group, index) => {
    tl.to(group.position, {
      x: targetX[index],
      y: 0.5,
      duration: 1,
      ease: "power2.inOut"
    }, 2);
    tl.to(group.scale, {
      x: 0.38,
      y: 0.38,
      z: 0.38,
      duration: 1,
      ease: "power2.inOut"
    }, 2);
  });

  tl.to(atmosMats.map(m => m.uniforms.uIntensity), {
    value: 3.5,
    duration: 1,
    ease: "power2.inOut"
  }, 2)
  .to(rotationParams, {
    offset: 3.5,
    autoSpin: 0.0,
    duration: 1,
    ease: "power2.inOut"
  }, 2);

  // ── Passo 3→4: Four Horizons → Transportation (Avião) ─────────────
  // Terra desaparece + Partículas aparecem como AVIÃO
  tl.to(earthGroups.map(g => g.scale), {
    x: 0.0,
    y: 0.0,
    z: 0.0,
    duration: 1,
    ease: "power2.inOut"
  }, 3)
  .to(atmosMats.map(m => m.uniforms.uIntensity), {
    value: 0.0,
    duration: 1,
    ease: "power2.inOut"
  }, 3)
  .to([glowMaterial, fogMaterial], {
    opacity: 0.0,
    duration: 1,
    ease: "power2.inOut"
  }, 3);

  // Partículas: fade-in como avião (modelo 0 → modelo 0)
  tl.to(morphState, {
    opacity: 1.0,
    duration: 1,
    ease: "power2.inOut",
    onUpdate: () => {
      particleSystem.setOpacity(morphState.opacity);
    }
  }, 3);

  // ── Passos 4→7: Morphing contínuo entre os 4 modelos ──────────────
  // scrollProgress: 0.0 = avião, 1.0 = energia, 2.0 = caminhão, 3.0 = datacenter
  // O GSAP anima scrollProgress de 0 a 3 linearmente ao longo de 3 intervalos.
  // No render loop, determinamos qual par de targets está ativo.
  tl.to(morphState, {
    scrollProgress: 3.0,
    duration: 3,
    ease: "none",
    onUpdate: () => {
      const sp = morphState.scrollProgress;
      const fromIdx = Math.min(Math.floor(sp), 2); // 0, 1, ou 2
      const toIdx = fromIdx + 1;                    // 1, 2, ou 3
      const localProgress = sp - fromIdx;           // 0.0 a 1.0 dentro do par

      // Se está exatamente em um modelo inteiro (ex: 0.0, 1.0, 2.0)
      if (localProgress < 0.001) {
        // Estamos no modelo fromIdx
        if (morphState._lastFrom !== fromIdx || morphState._lastTo !== fromIdx) {
          particleSystem.setMorphTargets(fromIdx, fromIdx);
          morphState._lastFrom = fromIdx;
          morphState._lastTo = fromIdx;
        }
        particleSystem.setMorphProgress(0.0);
      } else {
        // Transição entre fromIdx e toIdx
        if (morphState._lastFrom !== fromIdx || morphState._lastTo !== toIdx) {
          particleSystem.setMorphTargets(fromIdx, toIdx);
          morphState._lastFrom = fromIdx;
          morphState._lastTo = toIdx;
        }
        particleSystem.setMorphProgress(localProgress);
      }
    }
  }, 4);

  // ── Passo 7→8: Hypercenters → InfraCore (Partículas fade-out) ─────
  tl.to(morphState, {
    opacity: 0.0,
    duration: 1,
    ease: "power2.inOut",
    onUpdate: () => {
      particleSystem.setOpacity(morphState.opacity);
    }
  }, 7);

  // ── Passo 8→10: InfraCore → Footer (sem 3D) ───────────────────────
  tl.to({}, { duration: 4 }, 8);
}

// =========================================================================
// Pointer Events — ativar quando slides de partículas estão visíveis
// =========================================================================
const webglCanvas = document.querySelector('#webgl-canvas');
ScrollTrigger.defaults({ scroller: "#scroll-container" });

// Monitorar quando estamos nos slides 4-7 (partículas ativas)
ScrollTrigger.create({
  scroller: "#scroll-container",
  trigger: "#sec-transportation",
  endTrigger: "#sec-ai",
  start: "top center",
  end: "bottom center",
  onEnter: () => { webglCanvas.style.pointerEvents = 'auto'; },
  onLeave: () => { webglCanvas.style.pointerEvents = 'none'; },
  onEnterBack: () => { webglCanvas.style.pointerEvents = 'auto'; },
  onLeaveBack: () => { webglCanvas.style.pointerEvents = 'none'; },
});

// =========================================================================
// Resize Handler
// =========================================================================
window.addEventListener('resize', () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// =========================================================================
// Animation Loop
// =========================================================================
const clock = new THREE.Clock();

const tick = () => {
  const elapsedTime = clock.getElapsedTime();

  // Slow continuous rotation for all earths starting from Brazil
  earthGroups.forEach(group => {
    group.rotation.y = 1.8 + elapsedTime * 0.05;
  });

  // Atualizar sistema de partículas
  particleSystem.update(elapsedTime);

  renderer.render(scene, camera);
  window.requestAnimationFrame(tick);
};

tick();
