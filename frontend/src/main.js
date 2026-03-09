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
  editPixelinfoButton: document.querySelector("#editPixelinfoButton"),
  resetSelectedButton: document.querySelector("#resetSelectedButton"),
  focusSelectedButton: document.querySelector("#focusSelectedButton"),
  libraryCount: document.querySelector("#libraryCount"),
  libraryHint: document.querySelector("#libraryHint"),
  openAddFixtureButton: document.querySelector("#openAddFixtureButton"),
  cloneFixtureButton: document.querySelector("#cloneFixtureButton"),
  removeFixtureButton: document.querySelector("#removeFixtureButton"),
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
  configPathSelect: document.querySelector("#configPathSelect"),
  statusLine: document.querySelector("#statusLine"),
  loadProgress: document.querySelector("#loadProgress"),
  loadProgressBar: document.querySelector("#loadProgressBar"),
  fixtureModal: document.querySelector("#fixtureModal"),
  fixtureModalTitle: document.querySelector("#fixtureModalTitle"),
  fixtureModalCloseButton: document.querySelector("#fixtureModalCloseButton"),
  fixtureModalCancelButton: document.querySelector("#fixtureModalCancelButton"),
  fixtureModalApplyButton: document.querySelector("#fixtureModalApplyButton"),
  fixtureModalTemplateFields: document.querySelector("#fixtureModalTemplateFields"),
  modalTemplateRow: document.querySelector("#modalTemplateRow"),
  modalTemplateSelect: document.querySelector("#modalTemplateSelect"),
  modalGroupInput: document.querySelector("#modalGroupInput"),
  modalNameInput: document.querySelector("#modalNameInput"),
  modalPosX: document.querySelector("#modalPosX"),
  modalPosY: document.querySelector("#modalPosY"),
  modalPosZ: document.querySelector("#modalPosZ"),
  modalRotX: document.querySelector("#modalRotX"),
  modalRotY: document.querySelector("#modalRotY"),
  modalRotZ: document.querySelector("#modalRotZ"),
  modalPixelFunctionSelect: document.querySelector("#modalPixelFunctionSelect"),
  modalPixelFunctionMeta: document.querySelector("#modalPixelFunctionMeta"),
  modalPixelExpressionInput: document.querySelector("#modalPixelExpressionInput"),
  modalPreviewButton: document.querySelector("#modalPreviewButton"),
  modalClearPixelButton: document.querySelector("#modalClearPixelButton"),
  modalPreviewStatus: document.querySelector("#modalPreviewStatus"),
  modalPreviewCount: document.querySelector("#modalPreviewCount"),
  modalPreviewMeta: document.querySelector("#modalPreviewMeta"),
  modalPreviewViewport: document.querySelector("#modalPreviewViewport")
};

const state = {
  fixtures: [],
  fixtureLibrary: [],
  groupDefinitions: [],
  pixelFunctionLibrary: [],
  availableConfigFiles: [],
  fixtureVisuals: new Map(),
  originalTransforms: new Map(),
  originalSnapshot: null,
  currentConfigPath: null,
  currentConfigLabel: "",
  isDirty: false,
  isLoadingFixtures: false,
  selectedId: null,
  searchTerm: "",
  transformMode: "translate",
  transformSpace: "local",
  transformAxis: null,
  rayTargets: [],
  expandedGroups: new Set(),
  currentLibraryTemplateKey: null,
  fixtureModal: {
    mode: null,
    previewRequestId: 0,
    previewTimer: null,
    previewPayload: null
  }
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
let modalPreviewResizeObserver = null;

const modalPreviewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
modalPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
modalPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;

const modalPreviewScene = new THREE.Scene();
modalPreviewScene.background = new THREE.Color("#0a141d");
const modalPreviewCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
modalPreviewCamera.up.set(0, 0, 1);

const modalPreviewControls = new OrbitControls(modalPreviewCamera, modalPreviewRenderer.domElement);
modalPreviewControls.enableDamping = true;
modalPreviewControls.dampingFactor = 0.08;

const modalPreviewGroup = new THREE.Group();
modalPreviewScene.add(modalPreviewGroup);

init().catch((error) => {
  console.error(error);
  setStatus(error.message, true);
});

async function init() {
  dom.viewport.appendChild(renderer.domElement);
  dom.modalPreviewViewport.appendChild(modalPreviewRenderer.domElement);
  setupScene();
  bindUi();
  updateAxisUi();
  await loadFixtures();
  resizeRenderer();
  resizeModalPreviewRenderer();
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
  setupModalPreviewScene();

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", resizeRenderer);
  window.addEventListener("keydown", onKeyDown);
  viewportResizeObserver = new ResizeObserver(() => {
    resizeRenderer();
  });
  viewportResizeObserver.observe(dom.viewport);
  modalPreviewResizeObserver = new ResizeObserver(() => {
    resizeModalPreviewRenderer();
  });
  modalPreviewResizeObserver.observe(dom.modalPreviewViewport);
}

function setupModalPreviewScene() {
  modalPreviewScene.add(new THREE.HemisphereLight(0xcbe7ff, 0x16222d, 1.5));

  const keyLight = new THREE.DirectionalLight(0xfff1d2, 1.0);
  keyLight.position.set(5, -4, 8);
  modalPreviewScene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x5eb5ff, 0.35);
  fillLight.position.set(-6, 5, 5);
  modalPreviewScene.add(fillLight);

  modalPreviewGroup.add(buildFloorGrid(new THREE.Vector3(-2, -2, 0), new THREE.Vector3(2, 2, 0), 0.5));
  modalPreviewGroup.add(new THREE.AxesHelper(0.8));
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
      await loadFixtures(state.currentConfigPath);
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
  dom.configPathSelect.addEventListener("change", onConfigPathChange);
  dom.openAddFixtureButton.addEventListener("click", openAddFixtureModal);
  dom.cloneFixtureButton.addEventListener("click", cloneSelectedFixture);
  dom.removeFixtureButton.addEventListener("click", removeSelectedFixture);
  dom.editPixelinfoButton.addEventListener("click", openEditFixtureModal);

  dom.fixtureModal.addEventListener("click", (event) => {
    const closeTarget = event.target;
    if (closeTarget instanceof HTMLElement && closeTarget.dataset.closeModal === "true") {
      closeFixtureModal();
    }
  });
  dom.fixtureModalCloseButton.addEventListener("click", closeFixtureModal);
  dom.fixtureModalCancelButton.addEventListener("click", closeFixtureModal);
  dom.fixtureModalApplyButton.addEventListener("click", applyFixtureModal);
  dom.modalTemplateSelect.addEventListener("change", () => {
    state.currentLibraryTemplateKey = dom.modalTemplateSelect.value || null;
    populateModalFromTemplate(true);
    queueModalPreview();
  });
  dom.modalPixelFunctionSelect.addEventListener("change", () => {
    updateModalPixelFunctionMeta();
    if (getSelectedPixelFunction()) {
      applySelectedPixelFunction();
    } else {
      queueModalPreview();
    }
  });
  dom.modalPixelExpressionInput.addEventListener("input", () => {
    queueModalPreview();
  });
  dom.modalPreviewButton.addEventListener("click", () => {
    requestModalPreview();
  });
  dom.modalClearPixelButton.addEventListener("click", clearModalPixelinfo);
}

async function onConfigPathChange() {
  const nextConfigPath = dom.configPathSelect.value || null;
  if (state.isLoadingFixtures || nextConfigPath === state.currentConfigPath) {
    return;
  }

  const previousConfigPath = state.currentConfigPath || "";
  if (state.isDirty && !window.confirm("Discard current unsaved edits and load a different show file?")) {
    dom.configPathSelect.value = previousConfigPath;
    return;
  }

  try {
    await loadFixtures(nextConfigPath);
  } catch (error) {
    dom.configPathSelect.value = previousConfigPath;
    setStatus(error.message, true);
  }
}

function populateConfigPathOptions() {
  dom.configPathSelect.replaceChildren();

  for (const entry of state.availableConfigFiles) {
    const option = document.createElement("option");
    option.value = entry.path;
    option.textContent = entry.relativePath || entry.label || entry.path;
    dom.configPathSelect.appendChild(option);
  }

  if (state.currentConfigPath && !state.availableConfigFiles.some((entry) => entry.path === state.currentConfigPath)) {
    const option = document.createElement("option");
    option.value = state.currentConfigPath;
    option.textContent = state.currentConfigLabel || state.currentConfigPath;
    dom.configPathSelect.appendChild(option);
  }

  dom.configPathSelect.value = state.currentConfigPath || state.availableConfigFiles[0]?.path || "";
  dom.configPathSelect.disabled = state.isLoadingFixtures || dom.configPathSelect.options.length === 0;
  dom.reloadButton.disabled = state.isLoadingFixtures;
}

async function loadFixtures(configPath = state.currentConfigPath) {
  state.isLoadingFixtures = true;
  populateConfigPathOptions();
  setLoadingProgress(2, "Starting fixture load");

  try {
    const startResponse = await fetch("./api/load-jobs", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(configPath ? { configPath } : {})
    });
    const startPayload = await startResponse.json();
    if (!startResponse.ok) {
      throw new Error(startPayload.error || "Failed to start fixture load");
    }

    const payload = await waitForLoadJob(startPayload.jobId);
    state.originalSnapshot = cloneEditorPayload(payload);
    applyEditorPayload(payload);
    dom.outputPathInput.value = payload.defaultOutputPath;
    const configLabel = payload.configLabel || "config/controllables.py";
    setLoadingProgress(100, `Loaded ${state.fixtures.length} active fixtures from ${configLabel}`);
    setStatus(`Loaded ${state.fixtures.length} active fixtures from ${configLabel}`);
  } finally {
    state.isLoadingFixtures = false;
    populateConfigPathOptions();
  }
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

function applyEditorPayload(payload) {
  state.fixtures = (payload.fixtures || []).map(cloneFixture);
  state.fixtureLibrary = (payload.fixtureLibrary || []).map(cloneFixtureLibraryEntry);
  state.groupDefinitions = (payload.groupDefinitions || []).map(cloneGroupDefinition);
  state.pixelFunctionLibrary = [...(payload.pixelFunctionLibrary || [])];
  state.availableConfigFiles = (payload.availableConfigFiles || []).map(cloneConfigFileEntry);
  state.currentConfigPath = payload.configPath || null;
  state.currentConfigLabel = payload.configLabel || "";
  state.originalTransforms.clear();
  state.selectedId = null;
  state.fixtureVisuals.clear();
  state.rayTargets = [];
  state.currentLibraryTemplateKey = state.fixtureLibrary[0]?.key || null;
  populateConfigPathOptions();

  transformControls.detach();
  fixtureGroup.clear();
  helperGroup.clear();
  helperGroup.add(new THREE.AxesHelper(1.4));
  addRoomGuide(payload.roomBounds);

  for (const fixture of state.fixtures) {
    state.originalTransforms.set(fixture.id, {
      position: fixture.position.slice(),
      orientation: fixture.orientation.slice(),
      editableFields: cloneEditableFields(fixture.editableFields),
      kind: fixture.kind,
      pointCount: fixture.pointCount,
      points: Array.isArray(fixture.points) ? fixture.points.map((point) => point.slice()) : null
    });
    const visual = createFixtureVisual(fixture);
    state.fixtureVisuals.set(fixture.id, visual);
    fixtureGroup.add(visual.root);
    state.rayTargets.push(...visual.pickTargets);
  }

  syncFixtureLibrary(state.currentLibraryTemplateKey);
  renderFixtureList();
  selectFixture(null);
  updateDirtyState();
  frameObjects([...state.fixtureVisuals.values()].map((visual) => visual.root));
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
    updateLibraryUi();
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
  updateLibraryUi();
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
      if (fieldName === "name") {
        fixture.name = String(control.value).replace(/^['"]|['"]$/g, "");
        if (fixture.id === state.selectedId) {
          dom.selectionTitle.textContent = fixture.name;
        }
        syncFixtureLibrary(fixtureTemplateKey(fixture));
        renderFixtureList();
      }
      updateDirtyState();
    });
    wrapper.appendChild(control);
    dom.metadataFields.appendChild(wrapper);
  }
}

function renderLibraryControls() {
  dom.libraryCount.textContent = `${state.fixtureLibrary.length}`;
  updateLibraryUi();
}

function fixtureTemplateKey(fixture) {
  return `template:${fixture.id}`;
}

function buildFixtureLibraryEntryFromFixture(fixture) {
  const visual = state.fixtureVisuals.get(fixture.id);
  const transform = visual
    ? getCurrentFixtureTransform(fixture.id)
    : {
        position: fixture.position.slice(),
        orientation: fixture.orientation.slice()
      };

  const entry = {
    key: fixtureTemplateKey(fixture),
    label: fixture.name,
    group: fixture.group,
    kind: fixture.kind,
    role: fixture.role,
    position: transform.position.slice(),
    orientation: transform.orientation.slice(),
    pointCount: fixture.pointCount,
    editableFields: cloneEditableFields(fixture.editableFields),
    editableFieldOrder: [...(fixture.editableFieldOrder || [])]
  };
  if (Array.isArray(fixture.points)) {
    entry.points = fixture.points.map((point) => point.slice());
  }
  return entry;
}

function syncFixtureLibrary(preferredKey = null) {
  const nextLibrary = state.fixtures.map(buildFixtureLibraryEntryFromFixture);
  const nextKey = preferredKey || state.currentLibraryTemplateKey;

  state.fixtureLibrary = nextLibrary;
  if (nextKey && nextLibrary.some((template) => template.key === nextKey)) {
    state.currentLibraryTemplateKey = nextKey;
  } else {
    state.currentLibraryTemplateKey = nextLibrary[0]?.key || null;
  }

  renderLibraryControls();
}

function getCurrentLibraryTemplate() {
  return state.fixtureLibrary.find((template) => template.key === state.currentLibraryTemplateKey) || null;
}

function suggestNewGroupName(template) {
  const baseName = `${template.group} Copy`;
  const existingGroups = new Set(state.groupDefinitions.map((groupDefinition) => groupDefinition.name));
  if (!existingGroups.has(baseName)) {
    return baseName;
  }

  let counter = 2;
  while (existingGroups.has(`${baseName} ${counter}`)) {
    counter += 1;
  }
  return `${baseName} ${counter}`;
}

function suggestFixtureName(template, groupName) {
  const normalizedGroupName = normalizeGroupName(groupName) || template.group;
  return `${normalizedGroupName} 1`;
}

function updateLibraryUi() {
  const template = getCurrentLibraryTemplate();
  const removalState = getRemovalStateForFixture(state.selectedId);
  const cloneState = getCloneStateForFixture(state.selectedId);
  const canAdd = Boolean(template);

  dom.openAddFixtureButton.disabled = !canAdd;
  dom.cloneFixtureButton.disabled = !cloneState.allowed;
  dom.removeFixtureButton.disabled = !removalState.allowed;
  dom.editPixelinfoButton.disabled = !state.selectedId;

  if (!template) {
    dom.libraryHint.textContent = "No templates available in the current controllables.py.";
    return;
  }

  if (!state.selectedId) {
    dom.libraryHint.textContent = `Add opens a popup with a live preview. Current default template is ${template.group}.`;
    return;
  }

  if (cloneState.allowed && removalState.allowed) {
    dom.libraryHint.textContent = `Selected fixture can be cloned inside ${getSelectedFixture()?.group || "its group"} or removed if it is the only fixture in its group.`;
    return;
  }

  if (cloneState.allowed) {
    dom.libraryHint.textContent = `Selected fixture can be cloned inside ${getSelectedFixture()?.group || "its group"}. ${removalState.reason}`;
    return;
  }

  if (removalState.allowed) {
    dom.libraryHint.textContent = `Selected fixture can be removed. ${cloneState.reason}`;
    return;
  }

  dom.libraryHint.textContent = `${cloneState.reason} ${removalState.reason}`;
}

function openAddFixtureModal() {
  syncFixtureLibrary(state.currentLibraryTemplateKey);
  const template = getCurrentLibraryTemplate();
  if (!template) {
    setStatus("No fixture template is available.", true);
    return;
  }

  state.fixtureModal.mode = "add";
  state.fixtureModal.previewPayload = null;
  dom.fixtureModalTitle.textContent = "Add Fixture";
  dom.fixtureModalTemplateFields.hidden = false;
  dom.modalTemplateRow.hidden = false;
  dom.fixtureModalApplyButton.textContent = "Add Fixture";
  populateModalTemplateOptions();
  populateModalPixelFunctionOptions();
  populateModalFromTemplate(true);
  dom.fixtureModal.hidden = false;
  resizeModalPreviewRenderer();
  queueModalPreview();
}

function openEditFixtureModal() {
  const fixture = getSelectedFixture();
  if (!fixture) {
    setStatus("Select a fixture first.", true);
    return;
  }

  state.fixtureModal.mode = "edit";
  state.fixtureModal.previewPayload = null;
  dom.fixtureModalTitle.textContent = `Edit Fixture: ${fixture.name}`;
  dom.fixtureModalTemplateFields.hidden = false;
  dom.modalTemplateRow.hidden = true;
  dom.fixtureModalApplyButton.textContent = "Apply Fixture";
  dom.modalGroupInput.value = fixture.group;
  dom.modalNameInput.value = fixture.name;
  const currentTransform = getCurrentFixtureTransform(fixture.id);
  setModalTransformInputs(currentTransform.position, currentTransform.orientation);
  populateModalPixelFunctionOptions();
  dom.modalPixelExpressionInput.value = fixture.editableFields.pixelinfo || "";
  const matchedFunction = findPixelFunctionForExpression(dom.modalPixelExpressionInput.value);
  if (matchedFunction) {
    dom.modalPixelFunctionSelect.value = matchedFunction.key;
  } else {
    dom.modalPixelFunctionSelect.value = "";
  }
  updateModalPixelFunctionMeta();
  dom.fixtureModal.hidden = false;
  resizeModalPreviewRenderer();
  queueModalPreview();
}

function closeFixtureModal() {
  dom.fixtureModal.hidden = true;
  state.fixtureModal.mode = null;
  state.fixtureModal.previewPayload = null;
  dom.modalTemplateRow.hidden = false;
  if (state.fixtureModal.previewTimer) {
    window.clearTimeout(state.fixtureModal.previewTimer);
    state.fixtureModal.previewTimer = null;
  }
}

function populateModalTemplateOptions() {
  dom.modalTemplateSelect.replaceChildren();
  const hasActiveTemplate = state.fixtureLibrary.some((template) => template.key === state.currentLibraryTemplateKey);
  if (!hasActiveTemplate) {
    state.currentLibraryTemplateKey = state.fixtureLibrary[0]?.key || null;
  }

  for (const template of state.fixtureLibrary) {
    const option = document.createElement("option");
    option.value = template.key;
    option.textContent = `${template.label} (${template.group})`;
    dom.modalTemplateSelect.appendChild(option);
  }

  if (state.currentLibraryTemplateKey) {
    dom.modalTemplateSelect.value = state.currentLibraryTemplateKey;
  }
}

function populateModalPixelFunctionOptions() {
  dom.modalPixelFunctionSelect.replaceChildren();

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Keep current pixelinfo expression";
  dom.modalPixelFunctionSelect.appendChild(emptyOption);

  for (const pixelFunction of state.pixelFunctionLibrary) {
    const option = document.createElement("option");
    option.value = pixelFunction.key;
    option.textContent = `${pixelFunction.label}${pixelFunction.signature}`;
    dom.modalPixelFunctionSelect.appendChild(option);
  }

  updateModalPixelFunctionMeta();
}

function populateModalFromTemplate(force = false) {
  const template = getCurrentLibraryTemplate();
  if (!template) {
    return;
  }

  if (force || !dom.modalGroupInput.value.trim()) {
    dom.modalGroupInput.value = suggestNewGroupName(template);
  }
  if (force || !dom.modalNameInput.value.trim()) {
    dom.modalNameInput.value = suggestFixtureName(template, dom.modalGroupInput.value.trim());
  }

  const existingExpression = template.editableFields.pixelinfo || "";
  const matchedFunction = findPixelFunctionForExpression(existingExpression);
  dom.modalPixelFunctionSelect.value = matchedFunction?.key || "";
  updateModalPixelFunctionMeta();
  if (force || !dom.modalPixelExpressionInput.value.trim()) {
    dom.modalPixelExpressionInput.value = existingExpression;
  }
  if (force) {
    setModalTransformInputs(suggestFixturePosition(template), template.orientation);
  }
}

function getSelectedPixelFunction() {
  return state.pixelFunctionLibrary.find((pixelFunction) => pixelFunction.key === dom.modalPixelFunctionSelect.value) || null;
}

function updateModalPixelFunctionMeta() {
  const pixelFunction = getSelectedPixelFunction();
  if (!pixelFunction) {
    dom.modalPixelFunctionMeta.textContent = "Choose one of the discovered pixel-device make functions to insert its expression.";
    return;
  }

  const exampleText = pixelFunction.examples.length > 0 ? ` Example: ${pixelFunction.examples[0]}` : "";
  dom.modalPixelFunctionMeta.textContent = `${pixelFunction.label}${pixelFunction.signature}.${exampleText}`;
}

function applySelectedPixelFunction() {
  const pixelFunction = getSelectedPixelFunction();
  if (!pixelFunction) {
    return;
  }
  dom.modalPixelExpressionInput.value = pixelFunction.suggestedExpression || "";
  queueModalPreview();
}

function clearModalPixelinfo() {
  dom.modalPixelFunctionSelect.value = "";
  dom.modalPixelExpressionInput.value = "";
  state.fixtureModal.previewPayload = null;
  renderModalPreview(null);
}

function queueModalPreview() {
  if (state.fixtureModal.previewTimer) {
    window.clearTimeout(state.fixtureModal.previewTimer);
  }
  state.fixtureModal.previewTimer = window.setTimeout(() => {
    requestModalPreview();
  }, 220);
}

async function requestModalPreview() {
  if (dom.fixtureModal.hidden) {
    return;
  }
  if (state.fixtureModal.previewTimer) {
    window.clearTimeout(state.fixtureModal.previewTimer);
    state.fixtureModal.previewTimer = null;
  }

  const expression = dom.modalPixelExpressionInput.value.trim();
  const requestId = state.fixtureModal.previewRequestId + 1;
  state.fixtureModal.previewRequestId = requestId;
  dom.modalPreviewStatus.textContent = expression ? "Rendering pixel preview..." : "No pixelinfo expression set.";

  try {
    const response = await fetch("./api/pixel-preview", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        expression,
        configPath: state.currentConfigPath,
      })
    });
    const payload = await response.json();
    if (requestId !== state.fixtureModal.previewRequestId) {
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Pixel preview failed");
    }
    state.fixtureModal.previewPayload = payload;
    renderModalPreview(payload);
  } catch (error) {
    if (requestId !== state.fixtureModal.previewRequestId) {
      return;
    }
    state.fixtureModal.previewPayload = null;
    renderModalPreview(null, error.message);
  }
}

function renderModalPreview(payload, errorMessage = "") {
  for (const child of [...modalPreviewGroup.children]) {
    if (child.userData.previewFixture) {
      modalPreviewGroup.remove(child);
    }
  }

  if (!payload) {
    dom.modalPreviewCount.textContent = "0 pts";
    dom.modalPreviewMeta.textContent = errorMessage || "No pixel points loaded.";
    dom.modalPreviewStatus.textContent = errorMessage || "No pixelinfo expression set.";
    return;
  }

  dom.modalPreviewCount.textContent = `${payload.pointCount} pts`;
  dom.modalPreviewMeta.textContent = payload.bounds
    ? `Bounds ${payload.bounds.min.map((value) => formatInputNumber(value, 2)).join(", ")} -> ${payload.bounds.max.map((value) => formatInputNumber(value, 2)).join(", ")}`
    : "No pixel points loaded.";
  dom.modalPreviewStatus.textContent = payload.expression
    ? `Previewing ${payload.expression}`
    : "Pixelinfo cleared.";

  if (!payload.points || payload.points.length === 0) {
    return;
  }

  const previewFixture = {
    id: "__modal_preview__",
    group: "Preview",
    position: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    kind: "synth",
    pointCount: payload.pointCount,
    editableFields: {},
    editableFieldOrder: [],
    points: payload.points
  };
  const visual = createFixtureVisual(previewFixture);
  visual.root.userData.previewFixture = true;
  modalPreviewGroup.add(visual.root);
  framePreviewObjects([visual.root]);
}

function framePreviewObjects(objects) {
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
  const direction = new THREE.Vector3(1.1, -1.4, 0.95).normalize();

  modalPreviewCamera.position.copy(center).addScaledVector(direction, distance);
  modalPreviewControls.target.copy(center);
  modalPreviewControls.update();
}

function resizeModalPreviewRenderer() {
  const width = dom.modalPreviewViewport.clientWidth || 420;
  const height = dom.modalPreviewViewport.clientHeight || 320;
  modalPreviewRenderer.setSize(width, height, false);
  modalPreviewCamera.aspect = width / height;
  modalPreviewCamera.updateProjectionMatrix();
}

function findPixelFunctionForExpression(expression) {
  const match = String(expression || "").trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\.(make[A-Za-z0-9_]*)\s*\(/);
  if (!match) {
    return null;
  }
  const key = `${match[1]}:${match[2]}`;
  return state.pixelFunctionLibrary.find((pixelFunction) => pixelFunction.key === key) || null;
}

function applyFixtureModal() {
  if (state.fixtureModal.mode === "add") {
    addFixtureFromModal();
  } else if (state.fixtureModal.mode === "edit") {
    applyFixtureEditsFromModal();
  }
}

function addFixtureFromModal() {
  const template = getCurrentLibraryTemplate();
  if (!template) {
    setStatus("No fixture template is available.", true);
    return;
  }

  const groupName = normalizeGroupName(dom.modalGroupInput.value) || suggestNewGroupName(template);
  if (!groupName) {
    setStatus("Enter a group name for the new fixture.", true);
    return;
  }
  if (state.groupDefinitions.some((groupDefinition) => groupDefinition.name === groupName)) {
    setStatus("This library currently creates new single-fixture groups. Choose a new group name.", true);
    return;
  }

  const pixelExpression = dom.modalPixelExpressionInput.value.trim();
  if (pixelExpression && !state.fixtureModal.previewPayload) {
    setStatus("Preview the pixelinfo expression successfully before adding the fixture.", true);
    return;
  }
  const transform = readModalTransformInputs();

  const fixture = buildFixtureFromTemplate(
    template,
    groupName,
    dom.modalNameInput.value.trim(),
    pixelExpression,
    state.fixtureModal.previewPayload,
    transform.position,
    transform.orientation
  );
  const visual = createFixtureVisual(fixture);
  const groupDefinition = buildGroupDefinitionFromTemplate(template, groupName);

  state.fixtures.push(fixture);
  state.groupDefinitions.push(groupDefinition);
  state.fixtureVisuals.set(fixture.id, visual);
  state.originalTransforms.set(fixture.id, {
    position: fixture.position.slice(),
    orientation: fixture.orientation.slice(),
    editableFields: cloneEditableFields(fixture.editableFields),
    kind: fixture.kind,
    pointCount: fixture.pointCount,
    points: Array.isArray(fixture.points) ? fixture.points.map((point) => point.slice()) : null
  });
  fixtureGroup.add(visual.root);
  state.rayTargets.push(...visual.pickTargets);
  state.expandedGroups.add(groupName);

  syncFixtureLibrary(fixtureTemplateKey(fixture));
  renderFixtureList();
  selectFixture(fixture.id);
  frameObjects([visual.root]);
  updateDirtyState();
  closeFixtureModal();
  setStatus(`Added ${fixture.name} as ${groupName}.`);
}

function applyFixtureEditsFromModal() {
  const fixture = getSelectedFixture();
  if (!fixture) {
    setStatus("Select a fixture first.", true);
    return;
  }

  const nextGroupName = normalizeGroupName(dom.modalGroupInput.value);
  const nextFixtureName = normalizeGroupName(dom.modalNameInput.value);
  if (!nextGroupName) {
    setStatus("Enter a group name.", true);
    return;
  }
  if (!nextFixtureName) {
    setStatus("Enter a fixture name.", true);
    return;
  }

  const pixelExpression = dom.modalPixelExpressionInput.value.trim();
  if (pixelExpression && !state.fixtureModal.previewPayload) {
    setStatus("Preview the pixelinfo expression successfully before applying it.", true);
    return;
  }
  const transform = readModalTransformInputs();

  const groupChangeResult = applyFixtureGroupChange(fixture, nextGroupName);
  if (!groupChangeResult.ok) {
    setStatus(groupChangeResult.error, true);
    return;
  }

  applyFixtureNameChange(fixture, nextFixtureName);
  fixture.position = transform.position;
  fixture.orientation = transform.orientation;
  applyPixelPreviewToFixture(fixture, pixelExpression, state.fixtureModal.previewPayload);
  refreshFixtureVisual(fixture.id);
  syncFixtureLibrary(fixtureTemplateKey(fixture));
  renderFixtureList();
  updateDirtyState();
  closeFixtureModal();
  setStatus(`Updated ${fixture.name}.`);
}

function cloneSelectedFixture() {
  const cloneState = getCloneStateForFixture(state.selectedId);
  if (!cloneState.allowed) {
    setStatus(cloneState.reason || "Select a fixture to clone it.", true);
    return;
  }

  const sourceFixture = getSelectedFixture();
  if (!sourceFixture) {
    setStatus("Selected fixture is no longer available.", true);
    return;
  }

  const transform = getCurrentFixtureTransform(sourceFixture.id);
  const cloneFixtureEntry = cloneFixture(sourceFixture);
  cloneFixtureEntry.id = createAddedFixtureId();
  cloneFixtureEntry.name = suggestClonedFixtureName(sourceFixture);
  cloneFixtureEntry.position = [transform.position[0] + 0.45, transform.position[1], transform.position[2]];
  cloneFixtureEntry.orientation = transform.orientation.slice();
  cloneFixtureEntry.editableFields = cloneEditableFields(sourceFixture.editableFields);
  cloneFixtureEntry.editableFields.name = JSON.stringify(cloneFixtureEntry.name);
  cloneFixtureEntry.editableFieldOrder = sourceFixture.editableFieldOrder.includes("name")
    ? sourceFixture.editableFieldOrder.slice()
    : ["name", ...sourceFixture.editableFieldOrder];

  const groupDefinition = findGroupDefinition(sourceFixture.group);
  if (groupDefinition && "arrangement" in groupDefinition.fields) {
    setArrangementCount(groupDefinition, fixturesInGroup(sourceFixture.group).length + 1);
  }

  const visual = createFixtureVisual(cloneFixtureEntry);
  state.fixtures.push(cloneFixtureEntry);
  state.fixtureVisuals.set(cloneFixtureEntry.id, visual);
  state.originalTransforms.set(cloneFixtureEntry.id, {
    position: cloneFixtureEntry.position.slice(),
    orientation: cloneFixtureEntry.orientation.slice(),
    editableFields: cloneEditableFields(cloneFixtureEntry.editableFields),
    kind: cloneFixtureEntry.kind,
    pointCount: cloneFixtureEntry.pointCount,
    points: Array.isArray(cloneFixtureEntry.points) ? cloneFixtureEntry.points.map((point) => point.slice()) : null
  });
  fixtureGroup.add(visual.root);
  state.rayTargets.push(...visual.pickTargets);
  state.expandedGroups.add(cloneFixtureEntry.group);

  syncFixtureLibrary(fixtureTemplateKey(cloneFixtureEntry));
  renderFixtureList();
  selectFixture(cloneFixtureEntry.id);
  frameObjects([visual.root]);
  updateDirtyState();
  setStatus(`Cloned ${sourceFixture.name} in ${cloneFixtureEntry.group}.`);
}

function removeSelectedFixture() {
  const removalState = getRemovalStateForFixture(state.selectedId);
  if (!removalState.allowed) {
    setStatus(removalState.reason || "Select a removable fixture first.", true);
    return;
  }

  const fixture = state.fixtures.find((candidate) => candidate.id === state.selectedId);
  const visual = state.fixtureVisuals.get(fixture.id);
  if (visual) {
    fixtureGroup.remove(visual.root);
    state.fixtureVisuals.delete(fixture.id);
    state.rayTargets = state.rayTargets.filter((target) => !visual.pickTargets.includes(target));
  }

  state.fixtures = state.fixtures.filter((candidate) => candidate.id !== fixture.id);
  state.groupDefinitions = state.groupDefinitions.filter((groupDefinition) => groupDefinition.name !== fixture.group);
  state.originalTransforms.delete(fixture.id);
  state.expandedGroups.delete(fixture.group);

  syncFixtureLibrary();
  selectFixture(null);
  renderFixtureList();
  updateDirtyState();
  setStatus(`Removed ${fixture.name}.`);
}

function getRemovalStateForFixture(fixtureId) {
  if (!fixtureId) {
    return { allowed: false, reason: "Select a single-fixture group to remove it." };
  }

  const fixture = state.fixtures.find((candidate) => candidate.id === fixtureId);
  if (!fixture) {
    return { allowed: false, reason: "Selected fixture is no longer available." };
  }

  const groupSize = state.fixtures.filter((candidate) => candidate.group === fixture.group).length;
  if (groupSize !== 1) {
    return { allowed: false, reason: "Only single-fixture groups can be removed right now." };
  }

  return { allowed: true, reason: "" };
}

function getCloneStateForFixture(fixtureId) {
  if (!fixtureId) {
    return { allowed: false, reason: "Select a fixture to clone it inside its group." };
  }

  const fixture = state.fixtures.find((candidate) => candidate.id === fixtureId);
  if (!fixture) {
    return { allowed: false, reason: "Selected fixture is no longer available." };
  }

  const groupDefinition = findGroupDefinition(fixture.group);
  if (!groupDefinition) {
    return { allowed: false, reason: "Fixture group is missing from the editor state." };
  }

  const arrangement = parseArrangementExpression(groupDefinition.fields.arrangement);
  if ("arrangement" in groupDefinition.fields && (!arrangement || arrangement.length !== 1)) {
    return {
      allowed: false,
      reason: "Cloning is only supported for groups without arrangement or with a one-dimensional arrangement."
    };
  }

  return { allowed: true, reason: "" };
}

function findGroupDefinition(groupName) {
  return state.groupDefinitions.find((groupDefinition) => groupDefinition.name === groupName) || null;
}

function fixturesInGroup(groupName) {
  return state.fixtures.filter((fixture) => fixture.group === groupName);
}

function parseArrangementExpression(expression) {
  if (typeof expression !== "string" || expression.trim() === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(expression);
    return Array.isArray(parsed) && parsed.every((value) => Number.isInteger(value) && value > 0) ? parsed : null;
  } catch {
    return null;
  }
}

function setArrangementCount(groupDefinition, count) {
  if (!groupDefinition || !groupDefinition.fields || !("arrangement" in groupDefinition.fields)) {
    return;
  }
  groupDefinition.fields.arrangement = `[${count}]`;
}

function applyFixtureGroupChange(fixture, nextGroupName) {
  const previousGroupName = fixture.group;
  if (nextGroupName === previousGroupName) {
    return { ok: true };
  }

  if (findGroupDefinition(nextGroupName)) {
    return { ok: false, error: "Target group already exists. Use a new group name." };
  }

  const sourceGroupDefinition = findGroupDefinition(previousGroupName);
  if (!sourceGroupDefinition) {
    return { ok: false, error: `Group ${previousGroupName} is missing from the editor state.` };
  }

  const sourceFixtures = fixturesInGroup(previousGroupName);
  if (sourceFixtures.length <= 1) {
    sourceGroupDefinition.name = nextGroupName;
    fixture.group = nextGroupName;
    state.expandedGroups.delete(previousGroupName);
    state.expandedGroups.add(nextGroupName);
    return { ok: true };
  }

  const arrangement = parseArrangementExpression(sourceGroupDefinition.fields.arrangement);
  if ("arrangement" in sourceGroupDefinition.fields && (!arrangement || arrangement.length !== 1)) {
    return {
      ok: false,
      error: "Group changes are only supported for single-fixture groups or groups with a one-dimensional arrangement."
    };
  }

  const newGroupDefinition = cloneGroupDefinition(sourceGroupDefinition);
  newGroupDefinition.name = nextGroupName;
  if ("arrangement" in newGroupDefinition.fields) {
    newGroupDefinition.fields.arrangement = "[1]";
  }
  state.groupDefinitions.push(newGroupDefinition);

  if ("arrangement" in sourceGroupDefinition.fields) {
    setArrangementCount(sourceGroupDefinition, sourceFixtures.length - 1);
  }

  fixture.group = nextGroupName;
  state.expandedGroups.add(nextGroupName);
  return { ok: true };
}

function applyFixtureNameChange(fixture, nextFixtureName) {
  fixture.name = nextFixtureName;
  fixture.editableFields.name = JSON.stringify(nextFixtureName);
  if (!fixture.editableFieldOrder.includes("name")) {
    fixture.editableFieldOrder = ["name", ...fixture.editableFieldOrder];
  }
}

function buildGroupDefinitionFromTemplate(template, groupName) {
  const sourceGroup = state.groupDefinitions.find((groupDefinition) => groupDefinition.name === template.group)
    || state.originalSnapshot?.groupDefinitions?.find((groupDefinition) => groupDefinition.name === template.group);
  const groupDefinition = sourceGroup
    ? cloneGroupDefinition(sourceGroup)
    : { name: groupName, fieldOrder: [], fields: {} };
  groupDefinition.name = groupName;
  if ("arrangement" in groupDefinition.fields) {
    groupDefinition.fields.arrangement = "[1]";
  }
  return groupDefinition;
}

function buildFixtureFromTemplate(
  template,
  groupName,
  requestedName,
  pixelExpression = "",
  previewPayload = null,
  position = null,
  orientation = null
) {
  const editableFields = cloneEditableFields(template.editableFields);
  const fixtureName = requestedName || suggestFixtureName(template, groupName);
  editableFields.name = JSON.stringify(fixtureName);
  const editableFieldOrder = template.editableFieldOrder.includes("name")
    ? template.editableFieldOrder.slice()
    : ["name", ...template.editableFieldOrder];

  const fixture = {
    id: createAddedFixtureId(),
    group: groupName,
    name: fixtureName,
    role: template.role,
    kind: template.kind,
    position: position ? position.slice() : suggestFixturePosition(template),
    orientation: orientation ? orientation.slice() : template.orientation.slice(),
    pointCount: template.pointCount || (template.points ? template.points.length : 0),
    editableFields,
    editableFieldOrder,
    tags: []
  };

  if (Array.isArray(template.points)) {
    fixture.points = template.points.map((point) => point.slice());
  }

  applyPixelPreviewToFixture(fixture, pixelExpression, previewPayload, {
    fallbackPoints: Array.isArray(template.points) ? template.points : null
  });

  return fixture;
}

function suggestFixturePosition(template) {
  const selected = getSelectedVisual();
  if (selected) {
    return [
      selected.root.position.x + 0.45,
      selected.root.position.y,
      selected.root.position.z
    ];
  }
  return template.position.slice();
}

function applyPixelPreviewToFixture(fixture, pixelExpression, previewPayload, options = {}) {
  const expression = String(pixelExpression || "").trim();
  if (expression) {
    fixture.editableFields.pixelinfo = expression;
    if (!fixture.editableFieldOrder.includes("pixelinfo")) {
      fixture.editableFieldOrder.push("pixelinfo");
    }
    fixture.kind = "synth";
    fixture.points = previewPayload?.points?.map((point) => point.slice()) || options.fallbackPoints?.map((point) => point.slice()) || [];
    fixture.pointCount = fixture.points.length;
    return;
  }

  delete fixture.editableFields.pixelinfo;
  fixture.editableFieldOrder = fixture.editableFieldOrder.filter((fieldName) => fieldName !== "pixelinfo");
  delete fixture.points;
  fixture.pointCount = 0;
  fixture.kind = "conventional";
}

function getSelectedFixture() {
  return state.fixtures.find((fixture) => fixture.id === state.selectedId) || null;
}

function refreshFixtureVisual(fixtureId) {
  const fixture = state.fixtures.find((candidate) => candidate.id === fixtureId);
  if (!fixture) {
    return;
  }

  const previous = state.fixtureVisuals.get(fixtureId);
  if (previous) {
    if (state.selectedId === fixtureId) {
      transformControls.detach();
    }
    fixtureGroup.remove(previous.root);
    state.rayTargets = state.rayTargets.filter((target) => !previous.pickTargets.includes(target));
  }

  const visual = createFixtureVisual(fixture);
  state.fixtureVisuals.set(fixtureId, visual);
  fixtureGroup.add(visual.root);
  state.rayTargets.push(...visual.pickTargets);

  if (state.selectedId === fixtureId) {
    selectFixture(fixtureId);
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
  if (!state.originalSnapshot) {
    return;
  }
  applyEditorPayload(cloneEditorPayload(state.originalSnapshot));
  setStatus("Reset all fixture edits.");
}

function applyOriginalTransform(fixtureId) {
  const visual = state.fixtureVisuals.get(fixtureId);
  const fixture = state.fixtures.find((candidate) => candidate.id === fixtureId);
  const original = state.originalTransforms.get(fixtureId);
  if (!visual || !fixture || !original) {
    return;
  }
  visual.root.position.fromArray(original.position);
  visual.root.quaternion.set(...original.orientation);
  fixture.editableFields = cloneEditableFields(original.editableFields);
  fixture.kind = original.kind;
  fixture.pointCount = original.pointCount;
  if (Array.isArray(original.points)) {
    fixture.points = original.points.map((point) => point.slice());
  } else {
    delete fixture.points;
  }
  refreshFixtureVisual(fixtureId);
  syncFixtureLibrary(fixtureTemplateKey(fixture));
  if (fixtureId === state.selectedId) {
    renderMetadataFields(fixture);
  }
}

function updateDirtyState() {
  const originalFixtures = state.originalSnapshot?.fixtures || [];
  const originalIds = new Set(originalFixtures.map((fixture) => fixture.id));
  const currentIds = new Set(state.fixtures.map((fixture) => fixture.id));
  let dirty = originalIds.size !== currentIds.size || [...currentIds].some((id) => !originalIds.has(id));

  if (!dirty) {
    const originalGroupNames = new Set((state.originalSnapshot?.groupDefinitions || []).map((group) => group.name));
    const currentGroupNames = new Set(state.groupDefinitions.map((group) => group.name));
    dirty = originalGroupNames.size !== currentGroupNames.size || [...currentGroupNames].some((name) => !originalGroupNames.has(name));
  }

  for (const fixture of state.fixtures) {
    if (dirty) {
      break;
    }
    const current = getCurrentFixtureTransform(fixture.id);
    const original = state.originalTransforms.get(fixture.id);
    if (!original) {
      dirty = true;
      break;
    }
    const metadataDirty = !editableFieldsEqual(fixture.editableFields, original.editableFields);
    if (!arraysClose(current.position, original.position, 1e-6) || !arraysClose(current.orientation, original.orientation, 1e-6) || metadataDirty) {
      dirty = true;
      break;
    }
  }

  dom.dirtyBadge.textContent = dirty ? "Dirty" : "Clean";
  dom.dirtyBadge.style.color = dirty ? "var(--accent-strong)" : "var(--muted)";
  state.isDirty = dirty;
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
    configPath: state.currentConfigPath,
    outputPath,
    groupDefinitions: state.groupDefinitions.map((groupDefinition) => ({
      name: groupDefinition.name,
      fieldOrder: groupDefinition.fieldOrder.slice(),
      fields: { ...groupDefinition.fields }
    })),
    fixtures: state.fixtures.map((fixture) => ({
      id: fixture.id,
      group: fixture.group,
      ...getCurrentFixtureTransform(fixture.id),
      editableFields: fixture.editableFields,
      editableFieldOrder: fixture.editableFieldOrder.slice()
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
  if (
    event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement
  ) {
    return;
  }

  if (!dom.fixtureModal.hidden && event.key === "Escape") {
    closeFixtureModal();
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

function readModalTransformInputs() {
  const position = [dom.modalPosX, dom.modalPosY, dom.modalPosZ].map((input) => Number(input.value || 0));
  const rotation = [dom.modalRotX, dom.modalRotY, dom.modalRotZ].map((input) => THREE.MathUtils.degToRad(Number(input.value || 0)));
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], "XYZ"));
  return {
    position,
    orientation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
  };
}

function setModalTransformInputs(position, orientation) {
  const safePosition = Array.isArray(position) && position.length === 3 ? position : [0, 0, 0];
  const safeOrientation = Array.isArray(orientation) && orientation.length === 4 ? orientation : [0, 0, 0, 1];
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(safeOrientation[0], safeOrientation[1], safeOrientation[2], safeOrientation[3]),
    "XYZ"
  );

  dom.modalPosX.value = formatInputNumber(safePosition[0]);
  dom.modalPosY.value = formatInputNumber(safePosition[1]);
  dom.modalPosZ.value = formatInputNumber(safePosition[2]);
  dom.modalRotX.value = formatInputNumber(THREE.MathUtils.radToDeg(euler.x), 2);
  dom.modalRotY.value = formatInputNumber(THREE.MathUtils.radToDeg(euler.y), 2);
  dom.modalRotZ.value = formatInputNumber(THREE.MathUtils.radToDeg(euler.z), 2);
}

function normalizeGroupName(value) {
  return String(value || "").trim();
}

function createAddedFixtureId() {
  return `added:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function suggestClonedFixtureName(fixture) {
  const existingNames = new Set(state.fixtures.map((candidate) => candidate.name));
  const baseName = fixture.name.replace(/_\d+$/, "");
  let nextIndex = existingNames.has(baseName) ? 2 : 1;

  for (const name of existingNames) {
    const match = name.match(new RegExp(`^${escapeRegExp(baseName)}_(\\d+)$`));
    if (!match) {
      continue;
    }
    nextIndex = Math.max(nextIndex, Number(match[1]) + 1);
  }

  return `${baseName}_${nextIndex}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cloneFixture(fixture) {
  const clone = {
    ...fixture,
    position: fixture.position.slice(),
    orientation: fixture.orientation.slice(),
    editableFields: cloneEditableFields(fixture.editableFields),
    editableFieldOrder: [...(fixture.editableFieldOrder || [])],
    tags: [...(fixture.tags || [])]
  };
  if (Array.isArray(fixture.points)) {
    clone.points = fixture.points.map((point) => point.slice());
  }
  return clone;
}

function cloneFixtureLibraryEntry(template) {
  const clone = {
    ...template,
    position: template.position.slice(),
    orientation: template.orientation.slice(),
    editableFields: cloneEditableFields(template.editableFields),
    editableFieldOrder: [...(template.editableFieldOrder || [])]
  };
  if (Array.isArray(template.points)) {
    clone.points = template.points.map((point) => point.slice());
  }
  return clone;
}

function cloneConfigFileEntry(entry) {
  return { ...entry };
}

function cloneGroupDefinition(groupDefinition) {
  return {
    name: groupDefinition.name,
    fieldOrder: [...(groupDefinition.fieldOrder || [])],
    fields: { ...(groupDefinition.fields || {}) }
  };
}

function cloneEditorPayload(payload) {
  return {
    ...payload,
    configPath: payload.configPath || null,
    configLabel: payload.configLabel || "",
    roomBounds: payload.roomBounds
      ? {
          min: payload.roomBounds.min.slice(),
          max: payload.roomBounds.max.slice()
        }
      : null,
    fixtures: (payload.fixtures || []).map(cloneFixture),
    fixtureLibrary: (payload.fixtureLibrary || []).map(cloneFixtureLibraryEntry),
    availableConfigFiles: (payload.availableConfigFiles || []).map(cloneConfigFileEntry),
    groupDefinitions: (payload.groupDefinitions || []).map(cloneGroupDefinition),
    pixelFunctionLibrary: [...(payload.pixelFunctionLibrary || [])]
  };
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
  modalPreviewControls.update();
  renderer.render(scene, camera);
  modalPreviewRenderer.render(modalPreviewScene, modalPreviewCamera);
}
