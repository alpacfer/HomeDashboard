import { TENANT_SHAPES } from '@/lib/tenant-drawing';

// Reduced motion keeps the resident at home without starting its behavior
// scheduler. Same body contour as the live pet, with a quiet, static face.
export function WoodlandResident() {
  return <svg viewBox="0 0 100 100" aria-hidden="true">
    <ellipse cx="50" cy="99" rx="28" ry="3" fill="#203f32" opacity=".3" />
    <path d={TENANT_SHAPES.rest} fill="#fffdf4" stroke="#535348" strokeWidth="2.2" />
    <path d="M51 19Q53 9 48 3" fill="none" stroke="#647d47" strokeWidth="2" />
    <path d="M49 8Q33 9 35-2Q47-4 49 8ZM51 12Q53-1 64 1Q67 11 51 12Z" fill="#8ba95c" stroke="#647d47" strokeWidth="1.2" />
    <g fill="#fff" stroke="#535348" strokeWidth="1.5"><ellipse cx="36" cy="54" rx="8" ry="9" /><ellipse cx="63" cy="54" rx="8" ry="9" /></g>
    <g fill="#383b33"><ellipse cx="37" cy="54" rx="3" ry="4" /><ellipse cx="62" cy="54" rx="3" ry="4" /></g>
  </svg>;
}
