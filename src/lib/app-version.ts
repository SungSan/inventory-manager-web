import packageJson from "../../package.json";

/**
 * SAN WMS 화면에 표시하는 앱 버전의 단일 기준입니다.
 * 배포 버전은 package.json만 변경하면 모든 연결 화면에 자동 반영됩니다.
 */
export const APP_VERSION = String(packageJson.version);
export const APP_VERSION_LABEL = `V${APP_VERSION}`;

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
