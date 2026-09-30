import * as THREE from "../vendor/three.module.js";
import { territoryRadius } from "../sim/space.js";
import { offset } from "../sim/sphere.js";
import { habitat, renderRadius } from "../sim/terrain.js";
const V = (a) => new THREE.Vector3(...a);
export class PlanetView {
  constructor(
    canvas,
    onSelect,
    rendererFactory = (options) => new THREE.WebGLRenderer(options),
  ) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#000000");
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1500);
    this.distance = 290;
    this.yaw = 0;
    this.pitch = 0.2;
    this.target = new THREE.Vector3();
    this.follow = null;
    this.lastWorld = null;
    this.models = new Map();
    this.nodes = new Map();
    this.animals = new THREE.Group();
    this.decor = new THREE.Group();
    this.scene.add(this.animals, this.decor);
    this.renderer = rendererFactory({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.AmbientLight(0xb5c9e0, 1.3));
    const sun = new THREE.DirectionalLight(0xe0ebf5, 2);
    sun.position.set(130, 220, 160);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xc6d5e5, 0x161a20, 1.2));
    this.shared = {
      sphere: new THREE.SphereGeometry(1, 10, 7),
      cone: new THREE.ConeGeometry(1, 2, 7),
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(0.3, 0.35, 1, 6),
    };
    const geometry = new THREE.SphereGeometry(100, 96, 64);
    this.original = geometry.attributes.position.array.slice();
    this.planet = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    this.scene.add(this.planet);
    this.grid = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x637581,
        transparent: true,
        opacity: 0.32,
      }),
    );
    this.scene.add(this.grid);
    this.shared.marker = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.7, 0.15, 0),
      new THREE.Vector3(0.7, 0.15, 0),
      new THREE.Vector3(0, 0.15, -0.7),
      new THREE.Vector3(0, 0.15, 0.7),
      new THREE.Vector3(0, 0.15, 0),
      new THREE.Vector3(0, 1.4, 0),
    ]);
    this.motionVector = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      7,
      0xc5dde8,
      1.2,
      0.6,
    );
    this.motionVector.visible = false;
    this.scene.add(this.motionVector);
    this.selection = new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.1, 5, 32),
      new THREE.MeshBasicMaterial({ color: 0xc5dde8 }),
    );
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.territory = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x718d9a,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.scene.add(this.territory);
    this.conflictLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xd78a82 }),
    );
    this.scene.add(this.conflictLines);
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drag = null;
    this.moved = 0;
    canvas.addEventListener("pointerdown", (e) => {
      this.drag = [e.clientX, e.clientY];
      this.moved = 0;
      this.orbitFree = true;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag[0],
        dy = e.clientY - this.drag[1];
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.007;
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch + dy * 0.007));
      this.drag = [e.clientX, e.clientY];
    });
    canvas.addEventListener("pointerup", (e) => {
      if (this.drag && this.moved < 5) this.pick(e);
      this.drag = null;
    });
    canvas.addEventListener("pointercancel", () => {
      this.drag = null;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
    canvas.addEventListener("keydown", (e) => {
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(
          e.key,
        )
      ) {
        e.preventDefault();
        if (e.key === "ArrowLeft") this.yaw -= 0.12;
        if (e.key === "ArrowRight") this.yaw += 0.12;
        if (e.key === "ArrowUp") this.pitch = Math.min(1.45, this.pitch + 0.12);
        if (e.key === "ArrowDown")
          this.pitch = Math.max(-1.45, this.pitch - 0.12);
        if (e.key === "+") this.zoom(0.9);
        if (e.key === "-") this.zoom(1.1);
      }
    });
    this.resize();
  }
  material(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.82 });
  }
  mesh(geo, material, position, scale, parent) {
    const m = new THREE.Mesh(this.shared[geo], material);
    m.position.set(...position);
    m.scale.set(...scale);
    parent.add(m);
    return m;
  }
  creature(o) {
    const g = new THREE.Group(),
      t = o.traits;
    const color = new THREE.Color().setHSL(t.hue / 360, 0.35, 0.58);
    const membrane = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.38,
      roughness: 0.38,
      depthWrite: false,
    });
    const tissue = this.material(color.clone().multiplyScalar(0.65));
    const mineral = this.material(0xa5b9be);
    const pigment = this.material(color.clone().multiplyScalar(0.32));
    g.userData.materials = [membrane, tissue, mineral, pigment];
    g.userData.id = o.id;
    // A flattened, segmented capsule with visible internal compartments.
    // These are abstract phenotype glyphs, not reconstructions of real taxa.
    for (let i = 0; i < 3; i++) {
      const z = (i - 1) * 0.85;
      this.mesh("sphere", membrane, [0, 0.95, z], [1.05, 0.65, 0.9], g);
      this.mesh(
        "sphere",
        tissue,
        [0.12 * (i % 2 ? 1 : -1), 1, z],
        [0.38, 0.32, 0.48],
        g,
      );
    }
    const cilia = [];
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const filament = new THREE.Group();
        filament.position.set(side * 0.85, 0.95, -1.2 + i * 0.75);
        filament.rotation.z = (side * Math.PI) / 2;
        const length = 0.6 + ((t.speed - 24) / 36) * 0.7;
        this.mesh(
          "sphere",
          mineral,
          [0, -length / 2, 0],
          [0.045, length / 2, 0.045],
          filament,
        );
        filament.userData.baseAngle = filament.rotation.z;
        g.add(filament);
        cilia.push(filament);
      }
    g.userData.cilia = cilia;
    // Broad respiratory lamellae encode tolerance, without a vertebrate crest.
    for (let i = 0; i < 2 + Math.round(t.tolerance / 3); i++) {
      this.mesh(
        "sphere",
        mineral,
        [0, 1.45, -1 + i * 0.32],
        [0.62, 0.045, 0.1],
        g,
      );
    }
    for (const side of [-1, 1])
      for (let i = 0; i < Math.round(t.armor * 4); i++) {
        this.mesh(
          "sphere",
          tissue,
          [side * 0.7, 1.15, -1 + i * 0.6],
          [0.36, 0.18, 0.3],
          g,
        );
      }
    for (let i = 0; i < Math.round(t.pattern * 7); i++) {
      this.mesh(
        "sphere",
        pigment,
        [Math.sin(i * 2.4) * 0.5, 1.5, -1.15 + i * 0.35],
        [0.12, 0.05, 0.12],
        g,
      );
    }
    // Hunters have a radial capture basket; grazers have a fine filtering fan.
    const count = o.role === "predator" ? 6 : 10;
    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count;
      const appendage = this.mesh(
        "sphere",
        mineral,
        [Math.cos(angle) * 0.45, 0.95 + Math.sin(angle) * 0.3, 1.85],
        [
          o.role === "predator" ? 0.095 : 0.035,
          0.04,
          o.role === "predator" ? 0.6 : 0.36,
        ],
        g,
      );
      appendage.rotation.y = Math.cos(angle) * 0.4;
    }
    g.userData.bodyScale = 0.7 + t.size * 0.095;
    return g;
  }
  clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child.userData.materials)
        for (const mat of child.userData.materials) mat.dispose();
      else
        child.traverse((x) => {
          if (x.material && !x.userData.sharedMaterial) x.material.dispose();
        });
    }
  }
  terrain(world) {
    const pos = this.planet.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const n = new THREE.Vector3(
        ...this.original.slice(i * 3, i * 3 + 3),
      ).normalize();
      const r = renderRadius(n.toArray(), world.environment);
      pos.setXYZ(i, n.x * r, n.y * r, n.z * r);
    }
    pos.needsUpdate = true;
    // Latitude/longitude samples follow the terrain field, avoiding buried grid lines.
    const points = [];
    const point = (latitude, longitude) => {
      const n = [
        Math.cos(latitude) * Math.sin(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.cos(longitude),
      ];
      return V(n).multiplyScalar(renderRadius(n, world.environment) + 0.15);
    };
    for (let lat = -75; lat <= 75; lat += 15) {
      for (let lon = 0; lon < 360; lon += 2)
        points.push(
          point((lat * Math.PI) / 180, (lon * Math.PI) / 180),
          point((lat * Math.PI) / 180, ((lon + 2) * Math.PI) / 180),
        );
    }
    for (let lon = 0; lon < 360; lon += 15) {
      for (let lat = -90; lat < 90; lat += 2)
        points.push(
          point((lat * Math.PI) / 180, (lon * Math.PI) / 180),
          point(((lat + 2) * Math.PI) / 180, (lon * Math.PI) / 180),
        );
    }
    this.grid.geometry.dispose();
    this.grid.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.planet.geometry.computeVertexNormals();
    this.planet.geometry.computeBoundingSphere();
    this.clearGroup(this.decor);
    for (const obj of world.objects) {
      const env = habitat(obj.n, world.environment);
      if (env.water) continue;
      const g = new THREE.Group();
      g.position.copy(
        V(obj.n).multiplyScalar(renderRadius(obj.n, world.environment)),
      );
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(obj.n));
      g.scale.setScalar(obj.scale);
      const material = new THREE.LineBasicMaterial({
        color: obj.type === "tree" ? 0x546d78 : 0x818a91,
        transparent: true,
        opacity: 0.55,
      });
      g.userData.materials = [material];
      g.userData.fieldType = obj.type === "tree" ? "vegetation" : "mineral";
      g.add(new THREE.LineSegments(this.shared.marker, material));
      this.decor.add(g);
    }
  }
  orient(group, n, heading) {
    const up = V(n),
      forward = V(heading).normalize(),
      right = new THREE.Vector3().crossVectors(up, forward).normalize();
    group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, forward),
    );
  }
  focus(o, close = true) {
    if (!o) return;
    this.follow = o.id;
    this.orbitFree = false;
    this.yaw = Math.atan2(o.n[0], o.n[2]);
    this.pitch = Math.asin(o.n[1]);
    if (close) this.distance = 55;
  }
  overview() {
    this.follow = null;
    this.target.set(0, 0, 0);
    this.distance = 290;
  }
  zoom(factor) {
    this.distance = Math.max(
      this.follow ? 16 : 120,
      Math.min(480, this.distance * factor),
    );
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
  }
  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(
      [this.planet, ...this.animals.children],
      true,
    );
    if (hits.length) {
      let obj = hits[0].object;
      while (obj && obj.userData.id === undefined) obj = obj.parent;
      if (obj?.userData.id !== undefined) this.onSelect(obj.userData.id);
    }
  }
  render(world, selected) {
    if (this.lastWorld !== world) {
      this.clearGroup(this.animals);
      this.models.clear();
      this.nodes.clear();
      this.lastWorld = world;
      this.version = -1;
      this.overview();
      const n = world.homes[0];
      this.yaw = Math.atan2(n[0], n[2]);
      this.pitch = Math.asin(n[1]);
    }
    if (this.version !== world.environmentVersion) {
      this.terrain(world);
      this.version = world.environmentVersion;
    }
    const alive = new Set(world.organisms.map((o) => o.id));
    for (const [id, model] of this.models)
      if (!alive.has(id)) {
        this.animals.remove(model);
        for (const m of model.userData.materials) m.dispose();
        this.models.delete(id);
      }
    for (const o of world.organisms) {
      let model = this.models.get(o.id);
      if (!model) {
        model = this.creature(o);
        this.models.set(o.id, model);
        this.animals.add(model);
      }
      model.position.copy(
        V(o.n).multiplyScalar(renderRadius(o.n, world.environment) + 0.25),
      );
      this.orient(model, o.n, o.heading);
      model.scale.setScalar(
        model.userData.bodyScale * (o.age < 18 ? 0.5 + (0.5 * o.age) / 18 : 1),
      );
      model.userData.cilia.forEach((filament, i) => {
        filament.rotation.z =
          filament.userData.baseAngle +
          (Math.sin(world.time * 9 + o.id + i * 0.8) *
            0.22 *
            (o.control[1] + 1)) /
            2;
      });
      if (o.id === selected) {
        this.motionVector.visible = true;
        this.motionVector.position
          .copy(model.position)
          .addScaledVector(V(o.n), 2);
        this.motionVector.setDirection(V(o.heading).normalize());
        this.selection.visible = true;
        this.selection.position.copy(
          V(o.n).multiplyScalar(renderRadius(o.n, world.environment) + 0.4),
        );
        this.selection.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          V(o.n),
        );
        this.selection.scale.setScalar(model.userData.bodyScale);
      }
    }
    if (!alive.has(selected)) {
      this.selection.visible = false;
      this.motionVector.visible = false;
    }
    // Instanced food/egg markers stay cheap even when the habitat supports many resources.
    if (!this.resources) {
      this.resources = new THREE.InstancedMesh(
        this.shared.sphere,
        new THREE.MeshBasicMaterial({ color: 0x6c8790 }),
        2000,
      );
      this.resources.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.resources.frustumCulled = false;
      this.scene.add(this.resources);
      this.eggMesh = new THREE.InstancedMesh(
        this.shared.sphere,
        new THREE.MeshBasicMaterial({ color: 0xc8d3da }),
        400,
      );
      this.eggMesh.frustumCulled = false;
      this.scene.add(this.eggMesh);
    }
    const dummy = new THREE.Object3D();
    for (const [mesh, items, isEgg] of [
      [this.resources, world.food, false],
      [this.eggMesh, world.eggs, true],
    ]) {
      mesh.count = items.length;
      items.forEach((x, i) => {
        dummy.position.copy(
          V(x.n).multiplyScalar(
            renderRadius(x.n, world.environment) + (isEgg ? 1 : 0.5),
          ),
        );
        dummy.scale.setScalar(isEgg ? 1.5 : 0.38);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    const selectedAnimal = world.organisms.find((o) => o.id === selected);
    this.territory.visible = !!selectedAnimal;
    if (selectedAnimal) {
      const points = Array.from({ length: 96 }, (_, i) => {
        const n = offset(
          selectedAnimal.territoryCenter,
          (i * Math.PI * 2) / 96,
          territoryRadius(selectedAnimal),
        );
        return V(n).multiplyScalar(renderRadius(n, world.environment) + 0.4);
      });
      this.territory.geometry.dispose();
      this.territory.geometry = new THREE.BufferGeometry().setFromPoints(
        points,
      );
    }
    const clashes = world.events.filter(
      (e) => e.type === "conflict" || e.type === "attack",
    );
    this.conflictLines.geometry.dispose();
    this.conflictLines.geometry = new THREE.BufferGeometry().setFromPoints(
      clashes.flatMap((e) =>
        [e.a, e.b].map((n) =>
          V(n).multiplyScalar(renderRadius(n, world.environment) + 2),
        ),
      ),
    );
    const followed = world.organisms.find((o) => o.id === this.follow);
    if (followed) {
      this.target.copy(
        V(followed.n).multiplyScalar(
          renderRadius(followed.n, world.environment),
        ),
      );
      if (!this.drag && !this.orbitFree) {
        this.yaw = Math.atan2(followed.n[0], followed.n[2]);
        this.pitch = Math.asin(followed.n[1]);
      }
    } else if (this.follow) {
      this.overview();
    }
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.camera.position.copy(this.target).addScaledVector(dir, this.distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }
}
