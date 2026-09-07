import * as THREE from 'three'
export function mountHandScene(host: HTMLDivElement, animate: boolean): () => void {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.3
  host.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  camera.position.set(0, 0.55, 8.8)
  camera.lookAt(0, 0.35, 0)
  scene.add(new THREE.AmbientLight(0xd9eaff, 1.7))
  const key = new THREE.DirectionalLight(0xe5f9ff, 5); key.position.set(-3, 5, 5); scene.add(key)
  const rim = new THREE.DirectionalLight(0x386dff, 7); rim.position.set(3, 0, -2); scene.add(rim)
  const fill = new THREE.DirectionalLight(0x64ffd3, 2.5); fill.position.set(-3, -1, 1); scene.add(fill)
  const hand = new THREE.Group(); hand.rotation.set(-0.13, -0.32, -0.16); scene.add(hand)
  const material = new THREE.MeshPhysicalMaterial({ color: 0xb4ddfa, metalness: 0.38, roughness: 0.24, clearcoat: 0.65 })
  const joints = new THREE.MeshStandardMaterial({ color: 0x68eacb, emissive: 0x257c78, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.3 })
  function ellipsoid(x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), material)
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); hand.add(mesh)
  }
  ellipsoid(0, -0.25, 0, 0.67, 0.83, 0.29)
  ellipsoid(0.06, -1.1, -0.015, 0.39, 0.42, 0.24)
  const fingers = [
    [[-0.49, 0.12, 0], [-0.64, 0.76, 0.01], [-0.66, 1.32, 0.07], [-0.61, 1.66, 0.11]],
    [[-0.16, 0.35, 0], [-0.2, 1.04, 0], [-0.18, 1.67, 0.03], [-0.12, 2.03, 0.08]],
    [[0.18, 0.31, 0], [0.27, 0.98, 0], [0.32, 1.55, 0.07], [0.37, 1.89, 0.13]],
    [[0.48, 0.12, 0], [0.63, 0.66, 0.04], [0.72, 1.06, 0.12], [0.74, 1.34, 0.18]],
    [[-0.41, -0.62, 0.08], [-0.81, -0.37, 0.17], [-1.1, 0.03, 0.2], [-1.26, 0.35, 0.2]]
  ]
  fingers.forEach((finger, f) => {
    finger.slice(1).forEach((point, i) => {
      const a = new THREE.Vector3(...finger[i]); const b = new THREE.Vector3(...point)
      const radius = (f === 3 ? 0.115 : 0.145) * (1 - i * 0.08)
      const direction = b.clone().sub(a)
      const bone = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.04, direction.length() - radius), 6, 14), material)
      bone.position.copy(a.clone().add(b).multiplyScalar(0.5))
      bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); hand.add(bone)
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 8), joints)
      dot.position.copy(b); dot.position.z += radius; hand.add(dot)
    })
  })
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.6, 0.12, 64),
    new THREE.MeshStandardMaterial({ color: 0x172c50, metalness: 0.8, roughness: 0.25 }))
  pedestal.position.set(0, -1.88, 0); scene.add(pedestal)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.46, 0.012, 8, 96), joints)
  ring.rotation.x = Math.PI / 2; ring.position.y = -1.8; scene.add(ring)
  let frame = 0; let last = 0; let visible = true
  const target = new THREE.Vector2()
  const render = (now = 0) => {
    frame = 0
    if (document.hidden || !visible) return
    if (now - last >= 32 || !animate) {
      last = now
      hand.rotation.y += (-0.32 + target.x * 0.35 - hand.rotation.y) * 0.08
      hand.rotation.x += (-0.13 + target.y * 0.17 - hand.rotation.x) * 0.08
      hand.position.y = animate ? Math.sin(now * 0.0008) * 0.08 : 0
      renderer.render(scene, camera)
    }
    if (animate) frame = requestAnimationFrame(render)
  }
  const wake = () => { if (!frame) render(performance.now()) }
  const move = (event: PointerEvent) => {
    if (!animate || event.pointerType === 'touch') return
    const rect = host.getBoundingClientRect()
    target.set((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1)
  }
  const leave = () => target.set(0, 0)
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect()
    renderer.setSize(Math.max(1, width), Math.max(1, height))
    camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); wake()
  })
  resize.observe(host)
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake() })
  observer.observe(host)
  host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave)
  document.addEventListener('visibilitychange', wake)
  wake()
  return () => {
    cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect()
    host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave)
    document.removeEventListener('visibilitychange', wake)
    const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>()
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        geometries.add(obj.geometry)
        for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(mat)
      }
    })
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose())
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
  }
}
