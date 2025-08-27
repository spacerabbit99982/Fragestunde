
import { useState, useCallback, useRef, useEffect } from 'preact/compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// --- Type definitions for WebXR to fix compilation errors ---
type XRHitTestSource = any;
type XRFrame = any;

// --- 3D Viewer Component ---
// FIX: Removed forwardRef as it was causing type errors and was not being used.
export const Viewer = ({ modelCode, backgroundModelCode, showDimensions, onError }: { modelCode: string | null, backgroundModelCode: string | null, showDimensions: boolean, onError: (error: string) => void }) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const orbitControlsRef = useRef<OrbitControls | null>(null);
    const transformControlsRef = useRef<TransformControls | null>(null);
    const modelGroupRef = useRef<THREE.Object3D | null>(null);
    const backgroundGroupRef = useRef<THREE.Object3D | null>(null);
    
    // AR-specific refs and state
    const arStateRef = useRef({
        font: null as any,
        textMesh: null as THREE.Object3D | null,
        reticle: null as THREE.Mesh | null,
        hitTestSource: null as XRHitTestSource | null,
        hitTestSourceRequested: false,
        isModelPlaced: false,
        hintState: 'placing' as 'placing' | 'interacting' | 'faded',
        lastHintChangeTime: 0,
        queuedMessage: undefined as string | null | undefined,
    });
    
    // State for AR gestures, managed inside the animation loop for robustness
    const arGestureStateRef = useRef({
        active: false,
        touchCount: 0,
        initialModel: { position: new THREE.Vector3(), scale: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
        initialTouches: {
            pan: { intersection: new THREE.Vector3() },
            pinch: { dist: 0, angle: 0 }
        }
    });

    const arButtonRef = useRef<HTMLElement | null>(null);
    const photoButtonRef = useRef<HTMLButtonElement | null>(null);
    const takeArPhotoRef = useRef(false);

    const createAndDownloadImage = useCallback((pixels: Uint8Array, width: number, height: number) => {
        try {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const ctx = tempCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Konnte 2D-Kontext nicht vom temporären Canvas erhalten.');
            }

            const imageData = ctx.createImageData(width, height);
            
            // Bild vertikal spiegeln, da die Pixeldaten von WebGL umgedreht sind
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const sourceIndex = (y * width + x) * 4;
                    const destIndex = ((height - y - 1) * width + x) * 4;
                    imageData.data[destIndex]     = pixels[sourceIndex];
                    imageData.data[destIndex + 1] = pixels[sourceIndex + 1];
                    imageData.data[destIndex + 2] = pixels[sourceIndex + 2];
                    imageData.data[destIndex + 3] = pixels[sourceIndex + 3];
                }
            }
            ctx.putImageData(imageData, 0, 0);

            // Download-Link erstellen
            const imgUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
            const link = document.createElement('a');
            link.href = imgUrl;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.download = `holzbau-ar-foto-${timestamp}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e) {
            console.error("Fehler bei der Fotoerstellung aus Pixeldaten:", e);
            onError("Foto konnte nicht verarbeitet werden. " + (e instanceof Error ? e.message : String(e)));
        }
    }, [onError]);

    const handleCapturePhoto = useCallback(() => {
        const renderer = rendererRef.current;
        if (!renderer || !renderer.xr.isPresenting) {
            onError("Foto kann nur im AR-Modus aufgenommen werden.");
            return;
        }
        // Set a flag to be checked in the animation loop
        takeArPhotoRef.current = true;
    }, [onError]);
    
    const updateArText = useCallback((message: string | null) => {
        const arState = arStateRef.current;
        const scene = sceneRef.current;
        const font = arState.font;
        const camera = cameraRef.current;

        if (!font) {
            arState.queuedMessage = message;
            return;
        }

        if (!scene || !camera) return;

        if (arState.textMesh) {
            scene.remove(arState.textMesh);
            arState.textMesh = null;
        }

        if (message === null) return;

        const lines = message.split('\n');
        const textGroup = new THREE.Group();
        const textMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.95 });
        const lineHeight = 0.12; // in 3D units

        lines.forEach((line, index) => {
            const textGeo = new TextGeometry(line, {
                font: font,
                size: 0.08,
                height: 0.005,
                curveSegments: 4,
            });
            textGeo.center();
            const mesh = new THREE.Mesh(textGeo, textMat);
            mesh.position.y = -index * lineHeight;
            textGroup.add(mesh);
        });

        const box = new THREE.Box3().setFromObject(textGroup);
        const center = box.getCenter(new THREE.Vector3());
        textGroup.position.sub(center);

        textGroup.visible = true; // Make visible by default, billboard logic will position it.
        scene.add(textGroup);
        arState.textMesh = textGroup;
    }, []);

    useEffect(() => {
        if (!mountRef.current) return;
        const currentMount = mountRef.current;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.xr.enabled = true;
        currentMount.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0);
        scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
        dirLight.position.set(10, 15, 8);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 4096; dirLight.shadow.mapSize.height = 4096;
        dirLight.shadow.camera.near = 0.5; dirLight.shadow.camera.far = 50;
        scene.add(dirLight);
        sceneRef.current = scene;
        
        const fontLoader = new FontLoader();
        fontLoader.load('https://esm.sh/three/examples/fonts/helvetiker_regular.typeface.json', (font) => {
            const arState = arStateRef.current;
            arState.font = font;
            if (arState.queuedMessage !== undefined && arState.queuedMessage !== null) {
                updateArText(arState.queuedMessage);
                arState.queuedMessage = undefined;
            }
        });

        const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
        camera.position.set(5, 5, 15);
        cameraRef.current = camera;
        
        const orbitControls = new OrbitControls(camera, renderer.domElement);
        orbitControls.enableDamping = true; orbitControls.maxPolarAngle = Math.PI * 0.9;
        orbitControls.minDistance = 2; orbitControls.maxDistance = 50;
        orbitControlsRef.current = orbitControls;
        
        const transformControls = new TransformControls(camera, renderer.domElement);
        transformControls.addEventListener('dragging-changed', (event) => orbitControls.enabled = !event.value);
        scene.add(transformControls);
        transformControlsRef.current = transformControls;

        // --- Create AR Photo Button Programmatically ---
        const photoButton = document.createElement('button');
        photoButton.className = 'btn-ar-photo';
        photoButton.setAttribute('aria-label', 'Foto aufnehmen');
        photoButton.setAttribute('title', 'Foto aufnehmen');
        photoButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9a3.75 3.75 0 100 7.5 3.75 3.75 0 000-7.5z" />
              <path fill-rule="evenodd" d="M9.344 3.071a49.52 49.52 0 015.312 0c.967.052 1.787.245 2.5.65.713.405 1.32.956 1.84 1.625.52.668.913 1.442 1.156 2.309.243.867.337 1.806.337 2.845v.245c0 1.039-.094 1.978-.337 2.845-.243.867-.636 1.641-1.156 2.309-.52.668-1.127 1.22-1.84 1.625-.713.405-1.533.598-2.5.65-1.786.098-3.526.098-5.312 0-.967-.052-1.787-.245-2.5-.65-.713-.405-1.32-.956-1.84-1.625-.52-.668-.913-1.442-1.156-2.309-.243.867-.337-1.806-.337-2.845v-.245c0 1.039.094 1.978.337 2.845.243.867.636 1.641 1.156 2.309.52.668 1.127 1.22 1.84 1.625.713.405 1.533.598 2.5.65z" clip-rule="evenodd" />
            </svg>
        `;
        photoButton.style.display = 'none'; // Initially hidden
        photoButton.onclick = handleCapturePhoto;
        photoButtonRef.current = photoButton;

        // --- AR Interaction Logic ---
        const onSelectPlace = () => {
            const arState = arStateRef.current;
            const modelGroup = modelGroupRef.current;
            const reticle = arState.reticle;
            if (!modelGroup || arState.isModelPlaced || !reticle || !reticle.visible) return;

            const targetWorldPosition = new THREE.Vector3();
            const targetWorldQuaternion = new THREE.Quaternion();
            reticle.matrix.decompose(targetWorldPosition, targetWorldQuaternion, new THREE.Vector3());

            // --- Correct Bounding Box Calculation ---
            const dimensionsGroup = modelGroup.getObjectByName("dimensionsGroup");
            const dimensionsParent = dimensionsGroup ? dimensionsGroup.parent : null;
            
            if (dimensionsGroup && dimensionsParent) {
                dimensionsParent.remove(dimensionsGroup);
            }
            
            const rotatedPivot = modelGroup.getObjectByName("rotatedPivot");
            const geometryContainer = rotatedPivot || modelGroup;

            const oldQuaternion = geometryContainer.quaternion.clone();
            geometryContainer.quaternion.set(0, 0, 0, 1);
            modelGroup.updateMatrixWorld(true);

            const localBox = new THREE.Box3().setFromObject(geometryContainer);

            geometryContainer.quaternion.copy(oldQuaternion);
            if (dimensionsGroup && dimensionsParent) {
                dimensionsParent.add(dimensionsGroup);
            }
            modelGroup.updateMatrixWorld(true);

            const localAnchorOffset = new THREE.Vector3(
                localBox.max.x,
                localBox.min.y,
                localBox.max.z
            );

            const worldAnchorOffset = localAnchorOffset.clone().applyQuaternion(targetWorldQuaternion);
            const finalModelPosition = targetWorldPosition.clone().sub(worldAnchorOffset);

            modelGroup.position.copy(finalModelPosition);
            modelGroup.quaternion.copy(targetWorldQuaternion);
            modelGroup.scale.set(1, 1, 1);

            arState.isModelPlaced = true;
            arState.hintState = 'interacting';
            arState.lastHintChangeTime = performance.now();
            updateArText("Modell platziert.\n1 Finger: Verschieben\n2 Finger: Drehen & Skalieren");
            
            modelGroup.visible = true;
        };

        const controller = renderer.xr.getController(0);
        controller.addEventListener('select', onSelectPlace);
        scene.add(controller);

        const onSessionStart = () => {
            const arState = arStateRef.current;
            
            arState.isModelPlaced = false;
            arState.hitTestSource = null;
            arState.hitTestSourceRequested = false;
            arState.hintState = 'placing';
            updateArText("Freie Flaeche suchen...\nTippen zum Platzieren.");
            
            if (photoButtonRef.current) {
                document.body.appendChild(photoButtonRef.current);
                photoButtonRef.current.style.display = 'flex';
            }

            if (transformControlsRef.current) transformControlsRef.current.detach();
            if (backgroundGroupRef.current) backgroundGroupRef.current.visible = false;
            if (modelGroupRef.current) {
                modelGroupRef.current.userData.originalTransform = {
                    position: modelGroupRef.current.position.clone(),
                    quaternion: modelGroupRef.current.quaternion.clone(),
                    scale: modelGroupRef.current.scale.clone(),
                };
                modelGroupRef.current.visible = false;
            }
        };

        const onSessionEnd = () => {
            const arState = arStateRef.current;
            updateArText(null);
            if (photoButtonRef.current && photoButtonRef.current.parentNode) {
                photoButtonRef.current.parentNode.removeChild(photoButtonRef.current);
            }

            if (arState.hitTestSource) arState.hitTestSource.cancel();
            if (backgroundGroupRef.current) backgroundGroupRef.current.visible = true;
            if (modelGroupRef.current && modelGroupRef.current.userData.originalTransform) {
                const { position, quaternion, scale } = modelGroupRef.current.userData.originalTransform;
                modelGroupRef.current.position.copy(position);
                modelGroupRef.current.quaternion.copy(quaternion);
                modelGroupRef.current.scale.copy(scale);
                modelGroupRef.current.visible = true;
            }
            if (transformControlsRef.current) transformControlsRef.current.detach();
            const { current: cam } = cameraRef; const { current: orb } = orbitControlsRef;
            if (cam && orb && modelGroupRef.current) {
                const box = new THREE.Box3().setFromObject(modelGroupRef.current);
                const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                let cameraZ = Math.abs(maxDim / 2 * Math.tan(cam.fov * (Math.PI / 180) * 2)) * 1.5;
                cam.position.set(center.x, center.y + size.y * 0.5, center.z + cameraZ);
                orb.target.copy(center); orb.update();
            }
        };
        renderer.xr.addEventListener('sessionstart', onSessionStart);
        renderer.xr.addEventListener('sessionend', onSessionEnd);

        const checkAndSetupAr = async () => {
            let supported = false;
            if ('xr' in navigator) { try { supported = await (navigator.xr as any).isSessionSupported('immersive-ar'); } catch (e) { console.warn('AR support check failed.', e); } }
            if (!currentMount) return;
            const arButton = ARButton.createButton(renderer, { requiredFeatures: ['hit-test', 'local-floor'] });
            arButton.classList.add('btn', 'btn-ar'); arButton.textContent = 'In AR ansehen';
            currentMount.appendChild(arButton); arButtonRef.current = arButton;
            arButton.style.display = supported ? 'block' : 'none';
        };
        checkAndSetupAr();

        const arState = arStateRef.current;
        arState.reticle = new THREE.Mesh(
            new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({color: 0xffffff})
        );
        arState.reticle.matrixAutoUpdate = false; arState.reticle.visible = false;
        scene.add(arState.reticle);
        
        const animate = (timestamp: number, frame?: XRFrame) => {
            if (!renderer || !scene || !camera) return;
            const arState = arStateRef.current;
            const arGestureState = arGestureStateRef.current;
            const session = renderer.xr.getSession();
            const isPresenting = !!session;
            
            if (isPresenting && frame) {
                const referenceSpace = renderer.xr.getReferenceSpace();
                if (!referenceSpace) return;
                
                if (!arState.hitTestSourceRequested) {
                     session.requestReferenceSpace('viewer').then((viewerSpace) => {
                        session.requestHitTestSource({ space: viewerSpace }).then((source) => arState.hitTestSource = source)
                        .catch((e) => { onError("AR Hit-Testing konnte nicht initialisiert werden."); console.error(e); });
                    });
                    arState.hitTestSourceRequested = true;
                }

                if (arState.reticle) {
                    let hitPose = null;
                    if (arState.hitTestSource && !arState.isModelPlaced) {
                        const hitTestResults = frame.getHitTestResults(arState.hitTestSource);
                        if (hitTestResults.length > 0) {
                            hitPose = hitTestResults[0].getPose(referenceSpace);
                        }
                    }
                    
                    if (hitPose) {
                        arState.reticle.matrix.fromArray(hitPose.transform.matrix);
                        arState.reticle.visible = true;
                    } else {
                        arState.reticle.visible = false;
                    }
                }

                const activeTouches = Array.from(session.inputSources).filter((s: any) => s.targetRayMode === 'screen' && s.gamepad);
                if (arState.isModelPlaced) {
                    const modelGroup = modelGroupRef.current!;
                    
                    if (activeTouches.length > 0) {
                        if (!arGestureState.active || arGestureState.touchCount !== activeTouches.length) {
                            arGestureState.active = true;
                            arGestureState.touchCount = activeTouches.length;
                            
                            arGestureState.initialModel.position.copy(modelGroup.position);
                            arGestureState.initialModel.scale.copy(modelGroup.scale);
                            arGestureState.initialModel.quaternion.copy(modelGroup.quaternion);

                            if (activeTouches.length === 1) { // Pan
                               const axes = (activeTouches[0] as any).gamepad!.axes;
                                arGestureState.initialTouches.pan.intersection.set(axes[0], axes[1], 0);
                            } else if (activeTouches.length >= 2) { // Pinch/Rotate
                                const p1 = (activeTouches[0] as any).gamepad!.axes;
                                const p2 = (activeTouches[1] as any).gamepad!.axes;
                                arGestureState.initialTouches.pinch.dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
                                arGestureState.initialTouches.pinch.angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
                            }
                        } else {
                            if (activeTouches.length === 1) { // Pan
                                const axes = (activeTouches[0] as any).gamepad!.axes;
                                const currentTouch = new THREE.Vector2(axes[0], axes[1]);
                                const initialTouch = new THREE.Vector2(arGestureState.initialTouches.pan.intersection.x, arGestureState.initialTouches.pan.intersection.y);
                                const deltaTouch = currentTouch.clone().sub(initialTouch);
                                
                                const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                                const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                                camForward.y = 0; camForward.normalize();
                                camRight.y = 0; camRight.normalize();

                                const moveSpeedFactor = 3.0;
                                const moveVector = new THREE.Vector3();
                                moveVector.addScaledVector(camRight, deltaTouch.x * moveSpeedFactor);
                                moveVector.addScaledVector(camForward, deltaTouch.y * -moveSpeedFactor);

                                modelGroup.position.copy(arGestureState.initialModel.position).add(moveVector);

                            } else if (activeTouches.length >= 2) { // Pinch/Rotate
                                const p1 = (activeTouches[0] as any).gamepad!.axes; const p2 = (activeTouches[1] as any).gamepad!.axes;
                                const currentDist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
                                const currentAngle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);

                                const scaleFactor = currentDist / arGestureState.initialTouches.pinch.dist;
                                modelGroup.scale.copy(arGestureState.initialModel.scale).multiplyScalar(scaleFactor);

                                const angleDelta = arGestureState.initialTouches.pinch.angle - currentAngle;
                                const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleDelta);
                                modelGroup.quaternion.copy(arGestureState.initialModel.quaternion).multiply(deltaQuaternion);
                            }
                        }
                    } else {
                        if (arGestureState.active) {
                            arGestureState.active = false;
                            arGestureState.touchCount = 0;
                        }
                    }
                }
                
                const now = performance.now();
                const isInteracting = arGestureState.active;

                if (arState.isModelPlaced && arState.hintState !== 'faded') {
                    if (isInteracting) {
                        arState.lastHintChangeTime = now;
                        if (arState.hintState !== 'interacting') {
                            arState.hintState = 'interacting';
                            updateArText("Modell platziert.\n1 Finger: Verschieben\n2 Finger: Drehen & Skalieren");
                        }
                    } else {
                        if (arState.hintState === 'interacting' && now - arState.lastHintChangeTime > 4000) {
                            arState.hintState = 'faded';
                            updateArText(null);
                        }
                    }
                }

                if (arState.textMesh && arState.textMesh.visible) {
                    const targetPosition = new THREE.Vector3(0, 0, -2.5).applyMatrix4(camera.matrixWorld);
                    arState.textMesh.position.copy(targetPosition);
                    arState.textMesh.quaternion.copy(camera.quaternion);
                }

            } else if (orbitControlsRef.current) {
                orbitControlsRef.current.update();
            }
            renderer.render(scene, camera);
            
            // --- PHOTO CAPTURE LOGIC ---
            // Check the flag right after rendering the scene
            if (takeArPhotoRef.current) {
                takeArPhotoRef.current = false; // Reset flag immediately
                const gl = renderer.getContext();
                const width = gl.drawingBufferWidth;
                const height = gl.drawingBufferHeight;
                if (width === 0 || height === 0) {
                     onError("Konnte kein Foto aufnehmen, die Zeichenfläche hat keine Größe.");
                     return;
                }
                const pixels = new Uint8Array(width * height * 4);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                createAndDownloadImage(pixels, width, height);
            }
        };
        renderer.setAnimationLoop(animate);
        
        const handleResize = () => {
            if (!currentMount || !camera || !renderer) return;
            camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            renderer.setAnimationLoop(null); window.removeEventListener('resize', handleResize);
            if(orbitControlsRef.current) orbitControlsRef.current.dispose();
            if(transformControlsRef.current) transformControlsRef.current.dispose();
            renderer.xr.removeEventListener('sessionstart', onSessionStart); renderer.xr.removeEventListener('sessionend', onSessionEnd);
            controller.removeEventListener('select', onSelectPlace);
            const arButton = arButtonRef.current; if (arButton && arButton.parentNode) arButton.parentNode.removeChild(arButton);
            const photoBtn = photoButtonRef.current; if (photoBtn && photoBtn.parentNode) photoBtn.parentNode.removeChild(photoBtn);
            if(renderer.domElement.parentNode === currentMount) currentMount.removeChild(renderer.domElement);
            renderer.dispose();
        };
    }, [onError, updateArText, handleCapturePhoto, createAndDownloadImage]);

    useEffect(() => {
        const scene = sceneRef.current;
        const transform = transformControlsRef.current;
        const orbit = orbitControlsRef.current;
        const camera = cameraRef.current;
        if (!scene || !modelCode || !transform || !orbit || !camera) return;

        if (modelGroupRef.current) {
            transform.detach();
            scene.remove(modelGroupRef.current);
        }
        
        try {
            const textureLoader = new THREE.TextureLoader();
            const woodTextureUrl = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_planks/wood_planks_diff_1k.jpg';
            const endGrainTextureUrl = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plywood/plywood_diff_1k.jpg';

            Promise.all([
                textureLoader.loadAsync(woodTextureUrl),
                textureLoader.loadAsync(endGrainTextureUrl)
            ]).then(([woodTexture, endGrainTexture]) => {
                woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
                endGrainTexture.wrapS = endGrainTexture.wrapT = THREE.RepeatWrapping;
                
                const woodMaterial = new THREE.MeshStandardMaterial({ map: woodTexture, roughness: 0.8, metalness: 0.1 });
                const woodTextureVertical = woodTexture.clone();
                woodTextureVertical.needsUpdate = true; woodTextureVertical.rotation = Math.PI / 2; woodTextureVertical.center.set(0.5, 0.5);
                const woodMaterialVertical = new THREE.MeshStandardMaterial({ map: woodTextureVertical, roughness: 0.8, metalness: 0.1 });
                const endGrainMaterial = new THREE.MeshStandardMaterial({ map: endGrainTexture, roughness: 0.9, metalness: 0.0 });

                const createModelFunc = new Function('THREE', 'woodMaterial', 'woodMaterialVertical', 'endGrainMaterial', modelCode);
                const modelGroup = createModelFunc(THREE, woodMaterial, woodMaterialVertical, endGrainMaterial);
                
                if (!modelGroup || !(modelGroup instanceof THREE.Object3D)) {
                  throw new Error('Der generierte Code hat kein gültiges THREE.Object3D-Objekt zurückgegeben.');
                }
                
                modelGroup.traverse(child => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
                
                scene.add(modelGroup);
                modelGroupRef.current = modelGroup;

                modelGroup.visible = true;
                transform.detach();

                const box = new THREE.Box3().setFromObject(modelGroup);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = camera.fov * (Math.PI / 180);
                let cameraZ = Math.abs(maxDim / 2 * Math.tan(fov * 2)) * 1.5;
                camera.position.set(center.x, center.y + size.y * 0.5, center.z + cameraZ);
                orbit.target.copy(center);
                orbit.update();
            }).catch(loadError => {
                console.error("Fehler beim Laden der 3D-Texturen:", loadError);
                onError("Texturen konnten nicht geladen werden. Bitte versuchen Sie es erneut.");
            });

        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error("Fehler beim Erstellen des 3D-Modells:", errorMessage, "\nCode:", modelCode);
          onError(`Fehler beim Erstellen des 3D-Modells: ${errorMessage}`);
        }

    }, [modelCode, onError]);

    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene || !backgroundModelCode) {
            if (backgroundGroupRef.current) {
                scene.remove(backgroundGroupRef.current);
                backgroundGroupRef.current = null;
            }
            return;
        };

        if (backgroundGroupRef.current) scene.remove(backgroundGroupRef.current);

        try {
            const rawCode = backgroundModelCode.replace(/^```(javascript|js)?\s*|```\s*$/g, '').trim();
            if (!rawCode) throw new Error("Der von der KI generierte Hintergrund-Code war leer.");
            
            // Defensive check against HTML error pages returned by the API
            if (rawCode.trim().startsWith('<')) {
                console.error("Received HTML instead of JS for background:", rawCode);
                throw new Error("Der von der KI empfangene Code war HTML, was auf einen API-Fehler hindeutet. Bitte versuchen Sie es erneut.");
            }

            const wrappedCode = `const group = new THREE.Group();\n${rawCode}\nreturn group;`;
            const createBackgroundFunc = new Function('THREE', 'textureLoader', wrappedCode);
            const backgroundGroup = createBackgroundFunc(THREE, new THREE.TextureLoader());
            
            if (backgroundGroup instanceof THREE.Group) {
                backgroundGroup.traverse(child => { if (child instanceof THREE.Mesh) child.castShadow = false; });
                scene.add(backgroundGroup);
                backgroundGroupRef.current = backgroundGroup;
            } else {
                throw new Error("Der Hintergrund-Code hat keine gültige THREE.Group zurückgegeben.");
            }
        } catch (e) {
             console.error("Fehler bei Ausführung des Hintergrund-Codes:", e);
             onError(`Hintergrund konnte nicht geladen werden: ${e instanceof Error ? e.message : String(e)}`);
             if (backgroundGroupRef.current) {
                scene.remove(backgroundGroupRef.current);
                backgroundGroupRef.current = null;
            }
        }
    }, [backgroundModelCode, onError]);
    
    useEffect(() => {
        const model = modelGroupRef.current;
        if (!model) return;
        const dimensionsGroup = model.getObjectByName("dimensionsGroup");
        if (dimensionsGroup) dimensionsGroup.visible = showDimensions;
    }, [showDimensions, modelCode]);
    
    return (
        <div ref={mountRef} className="viewer-mount">
            <div className="three-instructions">
                 {'Klicken & Ziehen zum Drehen | Scrollen zum Zoomen'}
            </div>
        </div>
    );
};
