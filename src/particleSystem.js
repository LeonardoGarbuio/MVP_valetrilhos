import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================
const PARTICLE_COUNT = 2200;
const MOUSE_RADIUS = 1.8;
const MOUSE_STRENGTH = 0.6;
const POINT_SIZE = 0.8;

// ============================================================================
// CARREGAR MODELO GLB E EXTRAIR POSIÇÕES DOS VÉRTICES
// ============================================================================
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

/**
 * Carrega um arquivo .glb e amostra pontos uniformemente na SUPERFÍCIE dos triângulos.
 * Usa coordenadas baricêntricas aleatórias para distribuição uniforme.
 */
export function loadModelPositions(url, targetCount = PARTICLE_COUNT) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const triangles = []; // { a, b, c, area }
        const edgesList = []; // { a, b, length }
        let totalArea = 0;
        let totalEdgeLength = 0;

        gltf.scene.traverse((child) => {
          if (child.isMesh && child.geometry) {
            const geo = child.geometry;
            child.updateMatrixWorld(true);
            const posAttr = geo.attributes.position;
            const index = geo.index;

            // --- 1. Extrair Triângulos (Superfície) ---
            const vA = new THREE.Vector3();
            const vB = new THREE.Vector3();
            const vC = new THREE.Vector3();

            const triCount = index ? index.count / 3 : posAttr.count / 3;
            for (let t = 0; t < triCount; t++) {
              let iA, iB, iC;
              if (index) {
                iA = index.getX(t * 3); iB = index.getX(t * 3 + 1); iC = index.getX(t * 3 + 2);
              } else {
                iA = t * 3; iB = t * 3 + 1; iC = t * 3 + 2;
              }

              vA.fromBufferAttribute(posAttr, iA).applyMatrix4(child.matrixWorld);
              vB.fromBufferAttribute(posAttr, iB).applyMatrix4(child.matrixWorld);
              vC.fromBufferAttribute(posAttr, iC).applyMatrix4(child.matrixWorld);

              const ab = new THREE.Vector3().subVectors(vB, vA);
              const ac = new THREE.Vector3().subVectors(vC, vA);
              const area = ab.cross(ac).length() * 0.5;

              if (area > 0.0001) {
                triangles.push({ a: vA.clone(), b: vB.clone(), c: vC.clone(), area: area });
                totalArea += area;
              }
            }

            // --- 2. Extrair Arestas (Contorno/Silhueta) ---
            const edgesGeo = new THREE.EdgesGeometry(geo, 15); // Limite de 15 graus para detectar bordas "duras"
            const edgePos = edgesGeo.attributes.position;
            if (edgePos) {
              for (let i = 0; i < edgePos.count; i += 2) {
                const eA = new THREE.Vector3().fromBufferAttribute(edgePos, i).applyMatrix4(child.matrixWorld);
                const eB = new THREE.Vector3().fromBufferAttribute(edgePos, i + 1).applyMatrix4(child.matrixWorld);
                const len = eA.distanceTo(eB);
                if (len > 0.0001) {
                  edgesList.push({ a: eA, b: eB, length: len });
                  totalEdgeLength += len;
                }
              }
            }
          }
        });

        if (triangles.length === 0) {
          reject(new Error(`No triangles found in ${url}`));
          return;
        }

        // Centralizar e normalizar escala
        const bbox = new THREE.Box3();
        triangles.forEach(tri => { bbox.expandByPoint(tri.a); bbox.expandByPoint(tri.b); bbox.expandByPoint(tri.c); });
        edgesList.forEach(edge => { bbox.expandByPoint(edge.a); bbox.expandByPoint(edge.b); });
        
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 8.0 / maxDim;

        // Aplicar escala
        triangles.forEach(tri => {
          tri.a.sub(center).multiplyScalar(scale); tri.b.sub(center).multiplyScalar(scale); tri.c.sub(center).multiplyScalar(scale);
        });
        edgesList.forEach(edge => {
          edge.a.sub(center).multiplyScalar(scale); edge.b.sub(center).multiplyScalar(scale);
        });

        // Amostrar pontos: 55% no Contorno (Arestas) e 45% na Superfície
        const result = new Float32Array(targetCount * 3);
        const edgeCount = edgesList.length > 0 ? Math.floor(targetCount * 0.55) : 0;

        for (let i = 0; i < targetCount; i++) {
          if (i < edgeCount) {
            // Selecionar aresta proporcional ao comprimento
            let r = Math.random() * totalEdgeLength;
            let selectedEdge = edgesList[0];
            for (const edge of edgesList) {
              r -= edge.length;
              if (r <= 0) { selectedEdge = edge; break; }
            }
            // Ponto aleatório ao longo da aresta
            let t = Math.random();
            result[i * 3]     = selectedEdge.a.x + (selectedEdge.b.x - selectedEdge.a.x) * t;
            result[i * 3 + 1] = selectedEdge.a.y + (selectedEdge.b.y - selectedEdge.a.y) * t;
            result[i * 3 + 2] = selectedEdge.a.z + (selectedEdge.b.z - selectedEdge.a.z) * t;
          } else {
            // Selecionar triângulo proporcional à área
            let r = Math.random() * totalArea;
            let selectedTri = triangles[0];
            for (const tri of triangles) {
              r -= tri.area;
              if (r <= 0) { selectedTri = tri; break; }
            }
            // Ponto aleatório dentro do triângulo
            let u = Math.random(); let v = Math.random();
            if (u + v > 1) { u = 1 - u; v = 1 - v; }
            const w = 1 - u - v;
            result[i * 3]     = selectedTri.a.x * w + selectedTri.b.x * u + selectedTri.c.x * v;
            result[i * 3 + 1] = selectedTri.a.y * w + selectedTri.b.y * u + selectedTri.c.y * v;
            result[i * 3 + 2] = selectedTri.a.z * w + selectedTri.b.z * u + selectedTri.c.z * v;
          }
        }

        console.log(`[ParticleSystem] ${url}: ${triangles.length} triangles, sampled ${targetCount} surface points`);
        resolve(result);
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
  attribute float aSize;

  uniform float uMorphProgress;
  uniform vec3 uMouse3D;
  uniform float uTime;
  uniform float uPointSize;
  uniform float uMouseRadius;
  uniform float uMouseStrength;

  varying float vAlpha;
  varying float vBrightness;

  void main() {
    // Interpola entre os dois morph targets
    vec3 morphed = mix(targetA, targetB, uMorphProgress);

    // Micro-animação caótica e turbulenta (Movimento forte)
    float freq = 4.0; // Ondas mais curtas/ágeis
    float amp = 0.08; // Intensidade bem maior do movimento
    vec3 jitter = vec3(
      sin(uTime * 2.5 + morphed.y * freq + aRandom * 6.28) * amp,
      cos(uTime * 2.8 + morphed.x * freq + aRandom * 6.28) * amp,
      sin(uTime * 2.1 + morphed.z * freq + aRandom * 6.28) * amp
    );

    float breathe = sin(uTime * 1.5 + aRandom * 6.2831) * 0.03;
    morphed += jitter + (breathe * normalize(morphed + 0.001));

    // Repulsão do cursor (empurra partículas para fora)
    vec3 toParticle = morphed - uMouse3D;
    float dist = length(toParticle);
    float influence = smoothstep(uMouseRadius, 0.0, dist);
    vec3 pushDir = dist > 0.001 ? normalize(toParticle) : vec3(0.0, 1.0, 0.0);
    morphed += pushDir * influence * uMouseStrength;

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);

    // Tamanho variado por partícula — sutil (0.6 a 1.4)
    gl_PointSize = uPointSize * aSize * (70.0 / -mvPosition.z);
    gl_PointSize = max(gl_PointSize, 0.5); // mínimo meio pixel
    gl_Position = projectionMatrix * mvPosition;

    // Partículas perto do cursor ficam levemente mais transparentes
    vAlpha = 1.0 - influence * 0.3;
    // Partículas maiores são mais brilhantes (pontos estruturais)
    vBrightness = smoothstep(0.5, 3.0, aSize);
  }
`;

const particleFragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  varying float vBrightness;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // O "core" é o centro da bolinha. Aumentei bastante pra ficar MUITO mais branco!
    float core = smoothstep(0.28, 0.0, dist);
    // O halo ao redor
    float halo = smoothstep(0.4, 0.1, dist);
    
    float alpha = (core + halo * 0.6) * uOpacity * vAlpha;

    // A cor da bordinha agora é um azul super claro (quase branco-gelo)
    vec3 baseColor = vec3(0.4, 0.7, 0.95);
    vec3 brightColor = vec3(0.7, 0.9, 1.0);
    vec3 color = mix(baseColor, brightColor, vBrightness);

    // O miolo é 100% branco puro e agora ocupa um espaço muito maior
    color = mix(color, vec3(1.0, 1.0, 1.0), core);

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

    // Configurações individuais de Posição e Rotação para cada modelo
    this.modelConfigs = [
      { pos: new THREE.Vector3(0.0, 0.3, 0.0), rot: new THREE.Euler(0.488, 0.798, 0.498) },   // 0 - Avião
      { pos: new THREE.Vector3(-1.0, -0.7, 4.0), rot: new THREE.Euler(0.438, -0.102, 0.208) }, // 1 - Energia
      { pos: new THREE.Vector3(0.1, -0.9, -1.75), rot: new THREE.Euler(0.208, 2.598, 0.518) }, // 2 - Foguete
      { pos: new THREE.Vector3(-5.0, 0.3, -5.0), rot: new THREE.Euler(0.488, 0.798, 0.498) },  // 3 - DataCenter
      { pos: new THREE.Vector3(0.0, -5.0, -2.0), rot: new THREE.Euler(0.488, 0.798, 0.498) }   // 4 - InfraCore (Centro, metade inferior escondida)
    ];

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
    const sizes = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = targetA[i * 3];
      positions[i * 3 + 1] = targetA[i * 3 + 1];
      positions[i * 3 + 2] = targetA[i * 3 + 2];
      randoms[i] = Math.random();

      // Variação controlada de tamanho
      const r = Math.random();
      if (r < 0.65) {
        sizes[i] = 0.3 + Math.random() * 0.4;   // 65% Minúsculas (0.3 a 0.7)
      } else if (r < 0.95) {
        sizes[i] = 0.8 + Math.random() * 0.4;   // 30% Médias (0.8 a 1.2)
      } else {
        sizes[i] = 1.3 + Math.random() * 0.6;   // 5% Grandes, mas com limite! (1.3 a 1.9)
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('targetA', new THREE.BufferAttribute(targetA, 3));
    this.geometry.setAttribute('targetB', new THREE.BufferAttribute(targetB, 3));
    this.geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

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
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    
    // Posição e Rotação base (Inicia com o modelo 0)
    const conf = this.modelConfigs[0];
    this.points.position.copy(conf.pos);
    this.points.rotation.copy(conf.rot);
    
    this.scene.add(this.points);
  }

  /**
   * Cria la esfera branca que segue o cursor.
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

    // Garante que o índice das geometrias não passe do limite (reusa o DataCenter no passo 4)
    const safeFrom = Math.min(fromIndex, this.modelPositions.length - 1);
    const safeTo = Math.min(toIndex, this.modelPositions.length - 1);

    const a = this.modelPositions[safeFrom];
    const b = this.modelPositions[safeTo];

    if (!a || !b) return;

    this.geometry.attributes.targetA.array.set(a);
    this.geometry.attributes.targetA.needsUpdate = true;

    this.geometry.attributes.targetB.array.set(b);
    this.geometry.attributes.targetB.needsUpdate = true;

    this.currentIndex = fromIndex;
    this.nextIndex = toIndex;
  }

  /**
   * Define o progresso do morphing (0.0 = targetA, 1.0 = targetB).
   */
  setMorphProgress(progress) {
    if (!this.material) return;
    this.material.uniforms.uMorphProgress.value = progress;

    // Interpola a Posição e Rotação global do sistema inteiro (Move a câmera/objeto junto com o scroll)
    const fromConf = this.modelConfigs[this.currentIndex];
    const toConf = this.modelConfigs[this.nextIndex];
    
    if (fromConf && toConf && this.points) {
      // Interpolação linear da posição
      this.points.position.lerpVectors(fromConf.pos, toConf.pos, progress);
      
      // Interpolação esférica (Slerp) da rotação usando Quaternions para ser bem suave
      const qFrom = new THREE.Quaternion().setFromEuler(fromConf.rot);
      const qTo = new THREE.Quaternion().setFromEuler(toConf.rot);
      qFrom.slerp(qTo, progress);
      this.points.rotation.setFromQuaternion(qFrom);
    }
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
