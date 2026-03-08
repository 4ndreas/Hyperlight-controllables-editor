import "./styles.css";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const dom = {
  viewport: document.querySelector("#viewport"),
  searchInput: document.querySelector("#searchInput"),
  fixtureList: document.querySelector("#fixtureList"),
  fixtureCount: document.querySelector("#fixtureCount"),
  dirtyBadge: document.querySelector("#dirtyBadge"),
  selectionPlaceholder: document.querySelector("#selectionPlaceholder"),
  selectionForm: document.querySelector("#selectionForm"),
  selectionTitle: document.querySelector("#selectionTitle"),
  selectionMeta: document.querySelector("#selectionMeta"),
  posX: document.querySelector("#posX"),
  posY: document.querySelector("#posY"),
  posZ: document.querySelector("#posZ"),
  rotX: document.querySelector("#rotX"),
  rotY: document.querySelector("#rotY"),
  rotZ: document.querySelector("#rotZ"),
  axisStatus: document.querySelector("#axisStatus"),
  axisFreeButton: document.querySelector("#axisFreeButton"),
  axisXButton: document.querySelector("#axisXButton"),
  axisYButton: document.querySelector("#axisYButton"),
  axisZButton: document.querySelector("#axisZButton"),
  nudgeStepInput: document.querySelector("#nudgeStepInput"),
  nudgeNegativeButton: document.querySelector("#nudgeNegativeButton"),
  nudgePositiveButton: document.querySelector("#nudgePositiveButton"),
  metadataFields: document.querySelector("#metadataFields"),
  resetSelectedButton: document.querySelector("#resetSelectedButton"),
  focusSelectedButton: document.querySelector("#focusSelectedButton"),
  outputPathInput: document.querySelector("#outputPathInput"),
  downloadButton: document.querySelector("#downloadButton"),
  writeButton: document.querySelector("#writeButton"),
  resetAllButton: document.querySelector("#resetAllButton"),
  reloadButton: document.querySelector("#reloadButton"),
  translateModeButton: document.querySelector("#translateModeButton"),
  rotateModeButton: document.querySelector("#rotateModeButton"),
  localSpaceButton: document.querySelector("#localSpaceButton"),
  worldSpaceButton: document.querySelector("#worldSpaceButton"),
  frameAllButton: document.querySelector("#frameAllButton"),
  statusLine: document.querySelector("#statusLine"),
  loadProgress: document.querySelector("#loadProgress"),
  loadProgressBar: document.querySelector("#loadProgressBar")
};

const state = {
  fixtures: [],
  fixtureVisuals: new Map(),
  originalTransforms: new Map(),
  selectedId: null,
  searchTerm: "",
  transformMode: "translate",
  transformSpace: "local",
  transformAxis: null,
  rayTargets: [],
  expandedGroups: new Set()
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#08111a");
scene.fog = new THREE.FogExp2("#08111a", 0.03);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
camera.up.set(0, 0, 1);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSpace(state.transformSpace);
transformControls.setMode(state.transformMode);
transformControls.size = 1.25;
transformControls.addEventListener("dragging-changed", (event) => {
  orbitControls.enabled = !event.value;
});
transformControls.addEventListener("objectChange", () => {
  syncSelectionInputs();
  updateDirtyState();
});

scene.add(transformControls);

const fixtureGroup = new THREE.Group();
const helperGroup = new THREE.Group();
scene.add(helperGroup);
scene.add(fixtureGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let viewportResizeObserver = null;

init().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});

async function init() {
  dom.viewport.appendChild(renderer.domElement);
  setupScene();
  bindUi();
  updateAxisUi();
  await loadFixtures();
  resizeRenderer();
  animate();
}

function setupScene() {
  const ambientLight = new THREE.HemisphereLight(0xcbe7ff, 0x16222d, 1.4);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xfff1d2, 1.0);
  keyLight.position.set(7, -6, 10);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x5eb5ff, 0.35);
  fillLight.position.set(-8, 6, 6);
  scene.add(fillLight);

  helperGroup.add(new THREE.AxesHelper(1.4));

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", resizeRenderer);
  window.addEventListener("keydown", onKeyDown);
  viewportResizeObserver = new ResizeObserver(() => {
    resizeRenderer();
  });
  viewportResizeObserver.observe(dom.viewport);
}

function bindUi() {
  dom.searchInput.addEventListener("input", () => {
    state.searchTerm = dom.searchInput.value.trim().toLowerCase();
    renderFixtureList();
  });

  for (const input of [dom.posX, dom.posY, dom.posZ, dom.rotX, dom.rotY, dom.rotZ]) {
    input.addEventListener("change", applySelectionInputs);
  }

  dom.resetSelectedButton.addEventListener("click", resetSelectedFixture);
  dom.focusSelectedButton.addEventListener("click", () => {
    const visual = getSelectedVisual();
    if (visual) {
      frameObjects([visual.root]);
    }
  });

  dom.resetAllButton.addEventListener("click", resetAllFixtures);
  dom.reloadButton.addEventListener("click", async () => {
    try {
      await loadFixtures();
      setStatus("Reloaded from disk.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  dom.downloadButton.addEventListener("click", async () => {
    try {
      const result = await exportFixtures();
      downloadText(result.fileName, result.content);
      setStatus("Downloaded new controllables.py");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  dom.writeButton.addEventListener("click", async () => {
    try {
      const result = await exportFixtures(dom.outputPathInput.value.trim() || null);
      if (result.savedPath) {
        setStatus(`Wrote ${result.savedPath}`);
      } else {
        setStatus("No output path was provided.", true);
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  dom.translateModeButton.addEventListener("click", () => setTransformMode("translate"));
  dom.rotateModeButton.addEventListener("click", () => setTransformMode("rotate"));
  dom.localSpaceButton.addEventListener("click", () => setTransformSpace("local"));
  dom.worldSpaceButton.addEventListener("click", () => setTransformSpace("world"));
  dom.axisFreeButton.addEventListener("click", () => setTransformAxis(null));
  dom.axisXButton.addEventListener("click", () => setTransformAxis("X"));
  dom.axisYButton.addEventListener("click", () => setTransformAxis("Y"));
  dom.axisZButton.addEventListener("click", () => setTransformAxis("Z"));
  dom.nudgeNegativeButton.addEventListener("click", () => nudgeSelectedFixture(-1));
  dom.nudgePositiveButton.addEventListener("click", () => nudgeSelectedFixture(1));
  dom.frameAllButton.addEventListener("click", () => frameObjects([...state.fixtureVisuals.values()].map((visual) => visual.root)));
}

async function loadFixtures() {
  setLoadingProgress(2, "Starting fixture load");

  const startResponse = await fetch("./api/load-jobs", {
    method: "POST",
    cache: "no-store"
  });
  const startPayload = await startResponse.json();
  if (!startResponse.ok) {
    throw new Error(startPayload.error || "Failed to start fixture load");
  }

  const payload = await waitForLoadJob(startPayload.jobId);

  state.fixtures = payload.fixtures;
  state.originalTransforms.clear();
  state.selectedId = null;
  state.fixtureVisuals.clear();
  state.rayTargets = [];

  dom.outputPathInput.value = payload.defaultOutputPath;

  fixtureGroup.clear();
  helperGroup.clear();
  helperGroup.add(new THREE.AxesHelper(1.4));
  addRoomGuide(payload.roomBounds);

  for (const fixture of state.fixtures) {
    state.originalTransforms.set(fixture.id, {
      position: fixture.position.slice(),
      orientation: fixture.orientation.slice(),
      editableFields: cloneEditableFields(fixture.editableFields)
    });
    const visual = createFixtureVisual(fixture);
    state.fixtureVisuals.set(fixture.id, visual);
    fixtureGroup.add(visual.root);
    state.rayTargets.push(...visual.pickTargets);
  }

  renderFixtureList();
  selectFixture(null);
  updateDirtyState();
  frameObjects([...state.fixtureVisuals.values()].map((visual) => visual.root));
  setLoadingProgress(100, `Loaded ${state.fixtures.length} active fixtures from config/controllables.py`);
  setStatus(`Loaded ${state.fixtures.length} active fixtures from config/controllables.py`);
}

async function waitForLoadJob(jobId) {
  while (true) {
    const response = await fetch(`./api/load-jobs/${jobId}`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to read load progress");
    }

    setLoadingProgress(payload.progress || 0, payload.message || "Loading fixture data...");

    if (payload.status === "completed") {
      return payload.payload;
    }

    if (payload.status === "failed") {
      throw new Error(payload.error || payload.message || "Fixture load failed");
    }

    await sleep(200);
  }
}

function addRoomGuide(roomBounds) {
  if (!roomBounds) {
    return;
  }

  const min = new THREE.Vector3(...roomBounds.min);
  const max = new THREE.Vector3(...roomBounds.max);
  const size = new THREE.Vector3().subVectors(max, min);
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

  const box = new THREE.BoxGeometry(size.x, size.y, size.z);
  const edges = new THREE.EdgesGeometry(box);
  const wireframe = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x2f4b5f, transparent: true, opacity: 0.45 })
  );
  wireframe.position.copy(center);
  helperGroup.add(wireframe);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x, size.y),
    new THREE.MeshBasicMaterial({
      color: 0x0f1b26,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    })
  );
  floor.position.set(center.x, center.y, min.z);
  helperGroup.add(floor);

  const grid = buildFloorGrid(min, max, 1);
  helperGroup.add(grid);
}

function buildFloorGrid(min, max, spacing) {
  const positions = [];

  for (let x = Math.ceil(min.x); x <= Math.floor(max.x); x += spacing) {
    positions.push(x, min.y, min.z, x, max.y, min.z);
  }
  for (let y = Math.ceil(min.y); y <= Math.floor(max.y); y += spacing) {
    positions.push(min.x, y, min.z, max.x, y, min.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x244051, transparent: true, opacity: 0.3 })
  );
}

function createFixtureVisual(fixture) {
  const color = colorForGroup(fixture.group);
  const root = new THREE.Group();
  root.position.fromArray(fixture.position);
  root.quaternion.set(...fixture.orientation);
  root.rotation.order = "XYZ";
  root.userData.fixtureId = fixture.id;

  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 20, 20),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.14),
      roughness: 0.35,
      metalness: 0.15
    })
  );
  handle.userData.fixtureId = fixture.id;
  root.add(handle);

  const selectionProxy = new THREE.Mesh(
    new THREE.SphereGeometry(fixture.kind === "synth" ? 0.28 : 0.24, 16, 16),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    })
  );
  selectionProxy.userData.fixtureId = fixture.id;
  root.add(selectionProxy);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 18, 18),
    new THREE.MeshBasicMaterial({
      color: 0xf0b24d,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    })
  );
  halo.visible = false;
  root.add(halo);

  root.add(new THREE.AxesHelper(fixture.kind === "synth" ? 0.45 : 0.35));

  const pickTargets = [selectionProxy, handle];

  if (fixture.kind === "synth" && Array.isArray(fixture.points) && fixture.points.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fixture.points.flat(), 3));

    const pointCloud = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color,
        size: 0.05,
        transparent: true,
        opacity: 0.75,
        sizeAttenuation: true
      })
    );
    pointCloud.userData.fixtureId = fixture.id;
    root.add(pointCloud);
  } else {
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.34, 10),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color.clone().multiplyScalar(0.08),
        roughness: 0.5,
        metalness: 0.05
      })
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.17;
    arrow.add(shaft);

    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.085, 0.18, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffd089,
        emissive: new THREE.Color(0xffd089).multiplyScalar(0.14),
        roughness: 0.45,
        metalness: 0.05
      })
    );
    head.position.z = 0.42;
    arrow.add(head);

    arrow.userData.fixtureId = fixture.id;
    root.add(arrow);
    pickTargets.push(arrow);
  }

  return {
    fixture,
    root,
    handle,
    halo,
    pickTargets
  };
}

function renderFixtureList() {
  dom.fixtureList.replaceChildren();

  const fixtures = state.fixtures.filter((fixture) => matchesSearch(fixture, state.searchTerm));
  dom.fixtureCount.textContent = `${fixtures.length}`;

  const groupedFixtures = groupFixtures(fixtures);
  for (const [groupName, items] of groupedFixtures) {
    const details = document.createElement("details");
    details.className = "fixture-tree-group";
    details.open = state.searchTerm.length > 0 || state.expandedGroups.has(groupName) || items.some((fixture) => fixture.id === state.selectedId);
    details.addEventListener("toggle", () => {
      if (details.open) {
        state.expandedGroups.add(groupName);
      } else {
        state.expandedGroups.delete(groupName);
      }
    });

    const summary = document.createElement("summary");
    summary.className = "fixture-tree-summary";

    const title = document.createElement("span");
    title.className = "fixture-tree-title";
    title.textContent = groupName;
    summary.appendChild(title);

    const count = document.createElement("span");
    count.className = "badge";
    count.textContent = `${items.length}`;
    summary.appendChild(count);
    details.appendChild(summary);

    const itemContainer = document.createElement("div");
    itemContainer.className = "fixture-tree-items";

    for (const fixture of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fixture-button";
      if (fixture.id === state.selectedId) {
        button.classList.add("is-selected");
      }
      button.addEventListener("click", () => selectFixture(fixture.id));

      const name = document.createElement("span");
      name.className = "fixture-name";
      name.textContent = fixture.name;
      button.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "fixture-meta";
      meta.textContent = `${fixture.kind} | ${fixture.pointCount || 0} pts`;
      button.appendChild(meta);

      itemContainer.appendChild(button);
    }

    details.appendChild(itemContainer);
    dom.fixtureList.appendChild(details);
  }
}

function matchesSearch(fixture, searchTerm) {
  if (!searchTerm) {
    return true;
  }

  const haystack = [
    fixture.name,
    fixture.group,
    fixture.role,
    fixture.kind,
    ...(fixture.tags || [])
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(searchTerm);
}

function selectFixture(fixtureId) {
  state.selectedId = fixtureId;
  for (const [id, visual] of state.fixtureVisuals) {
    const selected = id === fixtureId;
    visual.halo.visible = selected;
    visual.handle.scale.setScalar(selected ? 1.15 : 1);
  }

  renderFixtureList();

  if (!fixtureId) {
    transformControls.detach();
    dom.selectionForm.hidden = true;
    dom.selectionPlaceholder.hidden = false;
    dom.selectionTitle.textContent = "";
    dom.selectionMeta.textContent = "";
    dom.metadataFields.replaceChildren();
    updateAxisUi();
    return;
  }

  const visual = state.fixtureVisuals.get(fixtureId);
  if (!visual) {
    return;
  }

  transformControls.attach(visual.root);
  dom.selectionPlaceholder.hidden = true;
  dom.selectionForm.hidden = false;
  dom.selectionTitle.textContent = visual.fixture.name;
  dom.selectionMeta.textContent = `${visual.fixture.group} | ${visual.fixture.kind} | ${visual.fixture.role || "No role"}`;
  syncSelectionInputs();
  renderMetadataFields(visual.fixture);
  updateAxisUi();
}

function syncSelectionInputs() {
  const visual = getSelectedVisual();
  if (!visual) {
    return;
  }

  const euler = new THREE.Euler().setFromQuaternion(visual.root.quaternion, "XYZ");
  dom.posX.value = formatInputNumber(visual.root.position.x);
  dom.posY.value = formatInputNumber(visual.root.position.y);
  dom.posZ.value = formatInputNumber(visual.root.position.z);
  dom.rotX.value = formatInputNumber(THREE.MathUtils.radToDeg(euler.x), 2);
  dom.rotY.value = formatInputNumber(THREE.MathUtils.radToDeg(euler.y), 2);
  dom.rotZ.value = formatInputNumber(THREE.MathUtils.radToDeg(euler.z), 2);
}

function applySelectionInputs() {
  const visual = getSelectedVisual();
  if (!visual) {
    return;
  }

  const position = [dom.posX, dom.posY, dom.posZ].map((input) => Number(input.value || 0));
  const rotation = [dom.rotX, dom.rotY, dom.rotZ].map((input) => THREE.MathUtils.degToRad(Number(input.value || 0)));

  visual.root.position.set(...position);
  visual.root.rotation.set(rotation[0], rotation[1], rotation[2], "XYZ");
  updateDirtyState();
}

function renderMetadataFields(fixture) {
  dom.metadataFields.replaceChildren();

  const fieldOrder = fixture.editableFieldOrder || Object.keys(fixture.editableFields || {});
  if (fieldOrder.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No editable fixture fields were found in this source block.";
    dom.metadataFields.appendChild(empty);
    return;
  }

  for (const fieldName of fieldOrder) {
    const wrapper = document.createElement("label");
    wrapper.className = "metadata-field";

    const title = document.createElement("span");
    title.textContent = fieldName;
    wrapper.appendChild(title);

    const fieldValue = fixture.editableFields[fieldName] ?? "";
    const control = isSingleLineField(fieldName) ? document.createElement("input") : document.createElement("textarea");
    control.value = fieldValue;
    control.addEventListener("input", () => {
      fixture.editableFields[fieldName] = control.value;
      updateDirtyState();
    });
    wrapper.appendChild(control);
    dom.metadataFields.appendChild(wrapper);
  }
}

function resetSelectedFixture() {
  const visual = getSelectedVisual();
  if (!visual) {
    return;
  }

  applyOriginalTransform(visual.fixture.id);
  syncSelectionInputs();
  updateDirtyState();
  setStatus(`Reset ${visual.fixture.name}`);
}

function resetAllFixtures() {
  for (const fixture of state.fixtures) {
    applyOriginalTransform(fixture.id);
  }
  syncSelectionInputs();
  updateDirtyState();
  setStatus("Reset all fixture transforms.");
}

function applyOriginalTransform(fixtureId) {
  const visual = state.fixtureVisuals.get(fixtureId);
  const original = state.originalTransforms.get(fixtureId);
  if (!visual || !original) {
    return;
  }
  visual.root.position.fromArray(original.position);
  visual.root.quaternion.set(...original.orientation);
  visual.fixture.editableFields = cloneEditableFields(original.editableFields);
  if (fixtureId === state.selectedId) {
    renderMetadataFields(visual.fixture);
  }
}

function updateDirtyState() {
  let dirty = false;
  for (const fixture of state.fixtures) {
    const current = getCurrentFixtureTransform(fixture.id);
    const original = state.originalTransforms.get(fixture.id);
    const metadataDirty = !editableFieldsEqual(fixture.editableFields, original.editableFields);
    if (!arraysClose(current.position, original.position, 1e-6) || !arraysClose(current.orientation, original.orientation, 1e-6) || metadataDirty) {
      dirty = true;
      break;
    }
  }

  dom.dirtyBadge.textContent = dirty ? "Dirty" : "Clean";
  dom.dirtyBadge.style.color = dirty ? "var(--accent-strong)" : "var(--muted)";
}

function getCurrentFixtureTransform(fixtureId) {
  const visual = state.fixtureVisuals.get(fixtureId);
  return {
    position: [visual.root.position.x, visual.root.position.y, visual.root.position.z],
    orientation: [visual.root.quaternion.x, visual.root.quaternion.y, visual.root.quaternion.z, visual.root.quaternion.w]
  };
}

function arraysClose(left, right, epsilon) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > epsilon) {
      return false;
    }
  }
  return true;
}

function getSelectedVisual() {
  return state.selectedId ? state.fixtureVisuals.get(state.selectedId) : null;
}

async function exportFixtures(outputPath = null) {
  const payload = {
    outputPath,
    fixtures: state.fixtures.map((fixture) => ({
      id: fixture.id,
      ...getCurrentFixtureTransform(fixture.id),
      editableFields: fixture.editableFields
    }))
  };

  const response = await fetch("./api/export", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Export failed");
  }
  return result;
}

function downloadText(fileName, content) {
  const blob = new Blob([content], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setTransformMode(mode) {
  state.transformMode = mode;
  transformControls.setMode(mode);
  dom.translateModeButton.classList.toggle("is-active", mode === "translate");
  dom.rotateModeButton.classList.toggle("is-active", mode === "rotate");
  updateAxisUi();
}

function setTransformSpace(space) {
  state.transformSpace = space;
  transformControls.setSpace(space);
  dom.localSpaceButton.classList.toggle("is-active", space === "local");
  dom.worldSpaceButton.classList.toggle("is-active", space === "world");
}

function setTransformAxis(axis) {
  state.transformAxis = axis;
  updateAxisUi();
}

function updateAxisUi() {
  const axis = state.transformAxis;
  dom.axisStatus.textContent = axis || "Free";
  dom.axisFreeButton.classList.toggle("is-active-axis", axis === null);
  dom.axisXButton.classList.toggle("is-active-axis", axis === "X");
  dom.axisYButton.classList.toggle("is-active-axis", axis === "Y");
  dom.axisZButton.classList.toggle("is-active-axis", axis === "Z");
  dom.nudgeNegativeButton.disabled = axis === null || !state.selectedId;
  dom.nudgePositiveButton.disabled = axis === null || !state.selectedId;
  transformControls.showX = axis === null || axis === "X";
  transformControls.showY = axis === null || axis === "Y";
  transformControls.showZ = axis === null || axis === "Z";
}

function nudgeSelectedFixture(direction) {
  const visual = getSelectedVisual();
  if (!visual || !state.transformAxis) {
    return;
  }

  const step = Number(dom.nudgeStepInput.value || 0.1) * direction;
  const axis = state.transformAxis.toLowerCase();
  visual.root.position[axis] += step;
  syncSelectionInputs();
  updateDirtyState();
}

function onPointerDown(event) {
  if (transformControls.dragging) {
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObjects(state.rayTargets, true);
  if (intersections.length === 0) {
    return;
  }

  const fixtureId = findFixtureId(intersections[0].object);
  if (fixtureId) {
    selectFixture(fixtureId);
  }
}

function findFixtureId(object) {
  let current = object;
  while (current) {
    if (current.userData && current.userData.fixtureId) {
      return current.userData.fixtureId;
    }
    current = current.parent;
  }
  return null;
}

function onKeyDown(event) {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  if (event.key === "t" || event.key === "T") {
    setTransformMode("translate");
  } else if (event.key === "r" || event.key === "R") {
    setTransformMode("rotate");
  } else if (event.key === "f" || event.key === "F") {
    const selected = getSelectedVisual();
    frameObjects(selected ? [selected.root] : [...state.fixtureVisuals.values()].map((visual) => visual.root));
  } else if (event.key === "Escape") {
    selectFixture(null);
  }
}

function resizeRenderer() {
  const width = dom.viewport.clientWidth || window.innerWidth;
  const height = dom.viewport.clientHeight || Math.max(480, window.innerHeight - 180);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function frameObjects(objects) {
  if (!objects || objects.length === 0) {
    return;
  }

  const box = new THREE.Box3();
  for (const object of objects) {
    box.expandByObject(object);
  }

  if (box.isEmpty()) {
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDimension * 1.8;
  const direction = new THREE.Vector3(1.1, -1.5, 0.95).normalize();

  camera.position.copy(center).addScaledVector(direction, distance);
  orbitControls.target.copy(center);
  orbitControls.update();
}

function formatInputNumber(value, digits = 3) {
  const rounded = Number.parseFloat(value.toFixed(digits));
  return Number.isFinite(rounded) ? String(rounded) : "0";
}

function colorForGroup(groupName) {
  let hash = 0;
  for (let index = 0; index < groupName.length; index += 1) {
    hash = (hash * 31 + groupName.charCodeAt(index)) % 360;
  }
  const color = new THREE.Color();
  color.setHSL(hash / 360, 0.6, 0.56);
  return color;
}

function setStatus(message, isError = false) {
  dom.statusLine.textContent = message;
  dom.statusLine.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function setLoadingProgress(progress, message) {
  const clamped = Math.max(0, Math.min(100, Number(progress) || 0));
  dom.loadProgressBar.style.width = `${clamped}%`;
  dom.loadProgress.setAttribute("aria-hidden", clamped >= 100 ? "true" : "false");
  if (message) {
    setStatus(message);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function cloneEditableFields(editableFields) {
  return Object.fromEntries(Object.entries(editableFields || {}).map(([key, value]) => [key, value]));
}

function editableFieldsEqual(left, right) {
  const leftEntries = Object.entries(left || {});
  const rightEntries = Object.entries(right || {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([key, value]) => right?.[key] === value);
}

function isSingleLineField(fieldName) {
  return ["name", "type", "artnet_in_universe", "dmx_out", "pixelinfo"].includes(fieldName);
}

function groupFixtures(fixtures) {
  const grouped = new Map();
  for (const fixture of fixtures) {
    if (!grouped.has(fixture.group)) {
      grouped.set(fixture.group, []);
    }
    grouped.get(fixture.group).push(fixture);
  }
  return [...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, camera);
}
