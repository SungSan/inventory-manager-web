import packageJson from "../../package.json";

/**
 * SAN WMS 화면에 표시하는 앱 버전의 단일 기준입니다.
 * 배포 버전은 package.json만 변경하면 모든 연결 화면에 자동 반영됩니다.
 */
export const APP_VERSION = String(packageJson.version);
export const APP_VERSION_LABEL = `V${APP_VERSION}`;

/**
 * 동의 유효성은 첫 번째 숫자인 메이저 버전으로만 판단합니다.
 * 4.2.7 -> 4.9.1은 동일 메이저, 4.9.1 -> 5.0.0은 다른 메이저입니다.
 */
export function semanticVersionMajor(value: string | null | undefined): number | null {
  const match = String(value ?? "").trim().match(/^(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : null;
}

export function hasSameSemanticMajor(...versions: Array<string | null | undefined>): boolean {
  const majors = versions.map(semanticVersionMajor);
  return majors.length > 0 && majors.every((major) => major !== null && major === majors[0]);
}

/**
 * 이용조건 원문에 과거 하드코딩된 `버전: [x.y.z]` 표시가 있더라도
 * 화면에는 현재 실행 중인 SAN WMS 앱 버전을 표시합니다.
 * 서버에 보존되는 약관 원문·해시·동의 기록은 변경하지 않습니다.
 */
export function displayContentWithCurrentAppVersion(content: string): string {
  return content.replace(
    /(^|\n)(버전\s*:\s*)\[[^\]]+\]/,
    `$1$2[${APP_VERSION_LABEL}]`,
  );
}
