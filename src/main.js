import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from '@studio-freight/lenis';

gsap.registerPlugin(ScrollTrigger);

// 1. Smooth Scroll Setup
const lenis = new Lenis({
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
    // Fundo azul muito escuro + luzes da cidade mais sutis
    vec3 introColor = exactNightColor + (nightColor.rgb * 0.3);
    
    // Normal State (uDayNightTransition = 1.0)
    vec3 normalColor = mix(nightColor.rgb * 0.5, dayColor.rgb, smoothLight);
    
    // Transição suave entre Intro e Normal
    vec3 earthColor = mix(introColor, normalColor, uDayNightTransition);
    
    // Fresnel glow on the rim (CORRECTED using view direction)
    vec3 viewDir = normalize(vViewPosition);
    float intensity = 1.0 - max(dot(normalize(vNormal), viewDir), 0.0);
    
    // Linha cyan fininha na borda (Rim Light)
    float rimPower = mix(25.0, 10.0, uDayNightTransition);
    float rimMultiplier = mix(3.0, 1.5, uDayNightTransition);
    float rimLight = pow(intensity, rimPower) * rimMultiplier;
    
    vec3 glow = uGlowColor * rimLight;

    // Mix to solid black based on fade progress
    vec3 baseColor = mix(earthColor, vec3(0.0), uFadeProgress);

    gl_FragColor = vec4(baseColor + glow, 1.0);
  }
`;

// Create 4 Earth Groups (1 main, 3 hidden initially behind the main one)
const earths = [];
const atmosMats = [];
const earthGroups = [];

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
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = 1.0 - max(dot(normalize(vNormal), viewDir), 0.0);
    
    // Linha ULTRA fina e delicada (como na imagem de referência)
    // Power altíssimo = glow concentrado só na beiradinha
    float thinLine = pow(fresnel, 80.0) * 5.0;
    // Uma camada levemente mais suave pra dar um "halo" sutil
    float softHalo = pow(fresnel, 12.0) * 0.15;
    
    float alpha = thinLine + softHalo;
    
    // Suavizar se mudar pro dia
    alpha = mix(alpha, alpha * 0.3, uDayNightTransition);
    
    gl_FragColor = vec4(uGlowColor, alpha);
  }
`;

for (let i = 0; i < 4; i++) {
  const group = new THREE.Group();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDayTexture: { value: earthDayTexture },
      uNightTexture: { value: earthNightTexture },
      uGlowColor: { value: new THREE.Color('#00aaff') }, // Cyan rim light
      uFadeProgress: { value: 0.0 }, // 0 = textured, 1 = dark
      uDayNightTransition: { value: 0.0 }, // Starts at night
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new THREE.Mesh(geometry, mat);
  group.add(mesh);
  
  // Atmosphere Mesh (Linha fina e delicada)
  const atmosMat = new THREE.ShaderMaterial({
    uniforms: {
      uGlowColor: { value: new THREE.Color('#88ccff') }, // Branco-azulado como na referência
      uDayNightTransition: { value: 0.0 }
    },
    vertexShader: atmosVertexShader,
    fragmentShader: atmosFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const atmosMesh = new THREE.Mesh(geometry, atmosMat);
  atmosMesh.scale.set(1.02, 1.02, 1.02); // Apenas 2% maior — colado na Terra
  group.add(atmosMesh);
  
  // Voltei para a curva mais suave (achatada) como na sua imagem
  group.position.set(0, -9.5, 0);
  group.scale.set(4.0, 4.0, 4.0);
  
  // Rotate slightly
  group.rotation.x = 0.5;
  group.rotation.z = 0.2;
  
  if (i > 0) {
    group.position.z = -0.01 * i;
  }
  
  scene.add(group);
  earths.push(mesh);
  atmosMats.push(atmosMat);
  earthGroups.push(group);
}

const mainEarth = earths[0];

// 4. GSAP Timeline driven by Scroll
// We use a single timeline mapped to the whole page scroll (.scroll-space)
const tl = gsap.timeline({
  scrollTrigger: {
    trigger: ".scroll-space",
    start: "top top",
    end: "bottom bottom",
    scrub: 1, // Smooth scrubbing
  }
});

// Phase 1: Earth rises to center and SHRINKS, Text 1 shrinks and moves up
tl.to(earthGroups.map(g => g.position), {
  y: 0, // Move to center
  duration: 1,
  ease: "power1.inOut"
}, 0)
.to(earthGroups.map(g => g.scale), {
  x: 1.6, // Shrink to fit center
  y: 1.6,
  z: 1.6,
  duration: 1,
  ease: "power1.inOut"
}, 0)
.to(earths.map(e => e.material.uniforms.uDayNightTransition), {
  value: 1.0, // Transition from full night to sunlit day/night
  duration: 1,
  ease: "power1.inOut"
}, 0)
.to(atmosMats.map(m => m.uniforms.uDayNightTransition), {
  value: 1.0, // Update atmosphere transition
  duration: 1,
  ease: "power1.inOut"
}, 0)
.to("#text-step-1", {
  scale: 0.6, // Scale down the text
  y: "-30vh", // Move it up towards the top
  duration: 1,
  ease: "power1.inOut"
}, 0)
.to("#text-step-1 .subtitle, #text-step-1 .explore-btn", {
  opacity: 0, // Fade out subtitle and button
  duration: 0.5,
  ease: "power1.inOut"
}, 0)
.to("#earth-ambient-glow", {
  opacity: 0,
  duration: 0.8,
  ease: "power1.inOut"
}, 0)
.to("#scroll-arrow", {
  opacity: 0,
  duration: 0.3,
  ease: "power1.inOut"
}, 0);

// Phase 2: Earth turns dark (Eclipse), Text 3 ("One Vision") appears
tl.to(earths.map(e => e.material.uniforms.uFadeProgress), {
  value: 1.0, // Fully dark
  duration: 1,
  ease: "power1.inOut"
}, 1)
.to("#text-step-3", {
  opacity: 1,
  y: 0, // Move to original pos
  duration: 0.8,
  ease: "power1.out"
}, 1.2);

// Phase 3: Earth divides into 4 and shrinks to fit, Text 3 fades, Text 4 appears
// Target X positions for 4 spheres
const spreadPositions = [-3.8, -1.25, 1.25, 3.8];

tl.to("#text-step-3", {
  opacity: 0,
  y: -30,
  duration: 0.5,
  ease: "power1.in"
}, 2)
.to(earthGroups[0].position, { x: spreadPositions[0], duration: 1, ease: "power2.inOut" }, 2.2)
.to(earthGroups[0].scale, { x: 0.9, y: 0.9, z: 0.9, duration: 1, ease: "power2.inOut" }, 2.2)
.to(earthGroups[1].position, { x: spreadPositions[1], duration: 1, ease: "power2.inOut" }, 2.2)
.to(earthGroups[1].scale, { x: 0.9, y: 0.9, z: 0.9, duration: 1, ease: "power2.inOut" }, 2.2)
.to(earthGroups[2].position, { x: spreadPositions[2], duration: 1, ease: "power2.inOut" }, 2.2)
.to(earthGroups[2].scale, { x: 0.9, y: 0.9, z: 0.9, duration: 1, ease: "power2.inOut" }, 2.2)
.to(earthGroups[3].position, { x: spreadPositions[3], duration: 1, ease: "power2.inOut" }, 2.2)
.to(earthGroups[3].scale, { x: 0.9, y: 0.9, z: 0.9, duration: 1, ease: "power2.inOut" }, 2.2)
.to("#text-step-4", {
  opacity: 1,
  y: 0,
  duration: 0.8,
  ease: "power1.out"
}, 2.4);


// Resize Handler
window.addEventListener('resize', () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// Animation Loop
const clock = new THREE.Clock();

const tick = () => {
  const elapsedTime = clock.getElapsedTime();

  // Slow continuous rotation for all earths
  earthGroups.forEach(group => {
    group.rotation.y = elapsedTime * 0.05;
  });

  renderer.render(scene, camera);
  window.requestAnimationFrame(tick);
};

tick();
