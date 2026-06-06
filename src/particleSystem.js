import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================
const PARTICLE_COUNT = 12000;
const MOUSE_RADIUS = 1.5;
const MOUSE_STRENGTH = 0.5;
const POINT_SIZE = 2.5;

// ============================================================================
// CARREGAR MODELO GLB E EXTRAIR POSIÇÕES DOS VÉRTICES
// ============================================================================
const loader = new GLTFLoader();

/**
 * Carrega um arquivo .glb e extrai as posições dos vértices.
 * Reamostra para `targetCount` pontos distribuídos uniformemente na superfície.
 */
export function loadModelPositions(url, targetCount = PARTICLE_COUNT) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const allPositions = [];

        gltf.scene.traverse((child) => {
          if (child.isMesh && child.geometry) {
            const geo = child.geometry;
            // Apply the mesh's world transform to get correct positions
            child.updateMatrixWorld(true);
            const posAttr = geo.attributes.position;
            
            for (let i = 0; i < posAttr.count; i++) {
              const v = new THREE.Vector3();
              v.fromBufferAttribute(posAttr, i);
              v.applyMatrix4(child.matrixWorld);
              allPositions.push(v);
            }
          }
        });

        if (allPositions.length === 0) {
          reject(new Error(`No vertices found in ${url}`));
          return;
        }

        // Centralizar e normalizar escala
        const bbox = new THREE.Box3();
        allPositions.forEach(v => bbox.expandByPoint(v));
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        // Escalar para caber em ~4 unidades de diâmetro
        const scale = 4.0 / maxDim;

        allPositions.forEach(v => {
          v.sub(center).multiplyScalar(scale);
        });

        // Reamostrar para targetCount
        const resampled = resamplePositions(allPositions, targetCount);
        resolve(resampled);
      },
      undefined,
      (error) => {
        console.error(`Error loading ${url}:`, error);
        reject(error);
      }
    );
  });
}

/**
 * Reamostra um array de Vector3 para exatamente `count` pontos.
 * Se tiver mais, amostra aleatoriamente. Se tiver menos, duplica com jitter.
 */
function resamplePositions(positions, count) {
  const result = new Float32Array(count * 3);

  if (positions.length >= count) {
    // Amostrar aleatoriamente
    const shuffled = [...positions].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      result[i * 3] = shuffled[i].x;
      result[i * 3 + 1] = shuffled[i].y;
      result[i * 3 + 2] = shuffled[i].z;
    }
  } else {
    // Preencher com os existentes + duplicar com jitter para completar
    for (let i = 0; i < count; i++) {
      const src = positions[i % positions.length];
      const jitter = i >= positions.length ? 0.02 : 0;
      result[i * 3] = src.x + (Math.random() - 0.5) * jitter;
      result[i * 3 + 1] = src.y + (Math.random() - 0.5) * jitter;
      result[i * 3 + 2] = src.z + (Math.random() - 0.5) * jitter;
    }
  }

  return result;
}

// ============================================================================
// SHADERS CUSTOMIZADOS
// ============================================================================
const particleVertexShader = /* glsl */ `
  attribute vec3 targetA;
  attribute vec3 targetB;
  attribute float aRandom;

  uniform float uMorphProgress;
  uniform vec3 uMouse3D;
  uniform float uTime;
  uniform float uPointSize;
  uniform float uMouseRadius;
  uniform float uMouseStrength;

  varying float vAlpha;
  varying float vDistToCenter;

  void main() {
    // Interpola entre os dois morph targets
    vec3 morphed = mix(targetA, targetB, uMorphProgress);

    // Micro-animação de flutuação/respiração
    float breathe = sin(uTime * 0.8 + aRandom * 6.2831) * 0.015;
    morphed += breathe * normalize(morphed + 0.001);

    // Repulsão do cursor (empurra partículas para fora)
    vec3 toParticle = morphed - uMouse3D;
    float dist = length(toParticle);
    float influence = smoothstep(uMouseRadius, 0.0, dist);
    vec3 pushDir = dist > 0.001 ? normalize(toParticle) : vec3(0.0, 1.0, 0.0);
    morphed += pushDir * influence * uMouseStrength;

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    gl_PointSize = uPointSize * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    // Partículas perto do cursor ficam levemente mais transparentes
    vAlpha = 1.0 - influence * 0.25;
    vDistToCenter = length(morphed);
  }
`;

const particleFragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  varying float vDistToCenter;

  void main() {
    // Ponto circular com glow suave
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // Core brilhante com falloff suave
    float core = smoothstep(0.5, 0.05, dist);
    float glow = smoothstep(0.5, 0.2, dist) * 0.4;
    float alpha = (core + glow) * uOpacity * vAlpha;

    // Cor: branco com leve tom azulado
    vec3 color = vec3(0.85, 0.92, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

// ============================================================================
// CLASSE PRINCIPAL DO SISTEMA DE PARTÍCULAS
// ============================================================================
export class ParticleModelSystem {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.modelPositions = [];  // Array de Float32Array (um por modelo)
    this.currentIndex = 0;     // Índice do modelo atual em targetA
    this.points = null;        // THREE.Points
    this.material = null;      // ShaderMaterial
    this.geometry = null;      // BufferGeometry

    // Mouse tracking
    this.mouse = new THREE.Vector2(9999, 9999); // Fora da tela inicialmente
    this.mouse3D = new THREE.Vector3(9999, 9999, 0);
    this.raycaster = new THREE.Raycaster();
    this.mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    // Esfera branca que segue o cursor
    this.cursorSphere = null;
    this.cursorSphereTargetPos = new THREE.Vector3(9999, 9999, 0);

    // Estado
    this.isVisible = false;
    this.morphProgress = 0;

    this._setupMouseTracking();
  }

  /**
   * Carrega todos os modelos e inicializa o sistema de partículas.
   * @param {string[]} urls - Array de URLs dos arquivos .glb
   */
  async init(urls) {
    console.log('[ParticleSystem] Loading models...');

    // Carregar todos os modelos em paralelo
    const promises = urls.map(url => loadModelPositions(url, PARTICLE_COUNT));
    this.modelPositions = await Promise.all(promises);

    console.log(`[ParticleSystem] Loaded ${this.modelPositions.length} models, ${PARTICLE_COUNT} particles each`);

    this._createParticles();
    this._createCursorSphere();
  }

  /**
   * Cria o sistema de partículas THREE.Points com shaders customizados.
   */
  _createParticles() {
    this.geometry = new THREE.BufferGeometry();

    // Posição inicial = primeiro modelo
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const targetA = new Float32Array(this.modelPositions[0]);
    const targetB = new Float32Array(this.modelPositions[0]);
    const randoms = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = targetA[i * 3];
      positions[i * 3 + 1] = targetA[i * 3 + 1];
      positions[i * 3 + 2] = targetA[i * 3 + 2];
      randoms[i] = Math.random();
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('targetA', new THREE.BufferAttribute(targetA, 3));
    this.geometry.setAttribute('targetB', new THREE.BufferAttribute(targetB, 3));
    this.geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMorphProgress: { value: 0.0 },
        uMouse3D: { value: new THREE.Vector3(9999, 9999, 0) },
        uTime: { value: 0.0 },
        uPointSize: { value: POINT_SIZE },
        uOpacity: { value: 0.0 },     // Começa invisível
        uMouseRadius: { value: MOUSE_RADIUS },
        uMouseStrength: { value: MOUSE_STRENGTH },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /**
   * Cria a esfera branca que segue o cursor.
   */
  _createCursorSphere() {
    const sphereGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0, // Começa invisível
    });
    this.cursorSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this.cursorSphere.position.set(9999, 9999, 0);
    this.scene.add(this.cursorSphere);
  }

  /**
   * Configura os event listeners do mouse.
   */
  _setupMouseTracking() {
    window.addEventListener('mousemove', (e) => {
      // Normaliza para -1..1
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
  }

  /**
   * Define os morph targets A e B para a transição atual.
   * @param {number} fromIndex - Índice do modelo de origem (0-3)
   * @param {number} toIndex - Índice do modelo de destino (0-3)
   */
  setMorphTargets(fromIndex, toIndex) {
    if (!this.geometry) return;

    const a = this.modelPositions[fromIndex];
    const b = this.modelPositions[toIndex];

    if (!a || !b) return;

    this.geometry.attributes.targetA.array.set(a);
    this.geometry.attributes.targetA.needsUpdate = true;

    this.geometry.attributes.targetB.array.set(b);
    this.geometry.attributes.targetB.needsUpdate = true;

    this.currentIndex = fromIndex;
  }

  /**
   * Define o progresso do morphing (0.0 = targetA, 1.0 = targetB).
   */
  setMorphProgress(progress) {
    if (!this.material) return;
    this.material.uniforms.uMorphProgress.value = progress;
  }

  /**
   * Define a opacidade do sistema de partículas (0.0 = invisível, 1.0 = visível).
   */
  setOpacity(opacity) {
    if (!this.material) return;
    this.material.uniforms.uOpacity.value = opacity;
    this.isVisible = opacity > 0;

    // Controla a esfera do cursor junto
    if (this.cursorSphere) {
      this.cursorSphere.material.opacity = opacity * 0.9;
    }
  }

  /**
   * Atualiza no render loop. Deve ser chamado a cada frame.
   */
  update(elapsedTime) {
    if (!this.material) return;

    this.material.uniforms.uTime.value = elapsedTime;

    // Projetar posição do mouse no plano Z=0
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersectPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.mousePlane, intersectPoint);

    if (intersectPoint) {
      // Suavizar o movimento do mouse 3D
      this.mouse3D.lerp(intersectPoint, 0.1);
      this.material.uniforms.uMouse3D.value.copy(this.mouse3D);

      // Atualizar posição da esfera do cursor
      if (this.cursorSphere && this.isVisible) {
        this.cursorSphere.position.lerp(intersectPoint, 0.08);
      }
    }
  }

  /**
   * Retorna os uniforms para que o GSAP possa animar diretamente.
   */
  getUniforms() {
    return this.material ? this.material.uniforms : null;
  }
}
