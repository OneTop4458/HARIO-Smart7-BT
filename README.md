# Smart7 Offline

HARIO V60 Auto Pour Over Smart7 BT (`EVS-70SV-BT`)용 커뮤니티 웹앱입니다. BLE로 본체를 연결해 자동 모드와 내 레시피를 실행합니다. 정적 파일로 배포하며 레시피와 연결 환경설정은 브라우저에 저장합니다.

## 사용하기

1. Android Chrome 또는 BLE를 지원하는 데스크톱 Chrome에서 HTTPS 배포 주소를 엽니다.
2. 화면에 **오프라인 사용 가능**이 표시되면 다음 실행부터 저장된 앱을 인터넷 없이 열 수 있습니다. 지원 브라우저에서는 설치 버튼이나 Chrome의 앱 설치 메뉴를 사용할 수 있습니다.
3. **Smart7 연결**을 눌러 목록에서 `EVS-70`이 포함된 이름을 선택하고 본체에 표시되는 6자리 PIN을 입력합니다.
4. 드리퍼, 서버와 물을 준비하고 자동 모드 또는 내 레시피에서 추출을 시작합니다. 동작 중 본체 가까이에서 상태를 확인하세요. 브라우저가 연결을 잃으면 본체에서 진행 상태를 확인하고 필요하면 본체 버튼으로 중지하세요.

- Safari의 Web Bluetooth 미지원으로 iPhone Safari에서는 본체 연결을 사용할 수 없습니다.
- **내 레시피**에서 JSON 파일을 내보내거나 가져올 수 있습니다. 과거 온라인 공유 레시피에는 해당 데이터의 원본이 필요합니다.
- APK 1.0.6에서 관찰한 BLE 통신을 기준으로 구현했습니다. 가상 GATT와 앱 흐름 테스트를 제공하며 실제 본체에서의 동작은 확인이 필요합니다.
- [HARIO 서비스 종료 공지](https://shop.hario.co.jp/smart7.html) · [Smart7 본체 설명서](https://smart7.jp/pdf/EVS-70_12P_setumei_L.pdf)

## 개발

```sh
npm test
python -m http.server 8080 --directory public
```

`http://localhost:8080`에서 엽니다. 정적 배포의 출력 디렉터리는 `public/`입니다. BLE 연결은 브라우저 보안 컨텍스트와 사용자의 기기 선택을 요구합니다.

- `public/protocol.js`는 GATT 세션, 패킷 인코딩과 추출 상태를 처리합니다.
- `public/recipes.js`는 자동 레시피와 입력 한도를 정의합니다.
- `public/sw.js`는 오프라인 사용에 필요한 앱 파일을 캐시합니다.

독립 프로젝트이며 HARIO가 운영하거나 보증하는 서비스가 아닙니다. 웹앱은 새 UI와 코드를 사용하며 원본 APK를 재배포하지 않습니다. 커피 사진은 ImageGen으로 생성했습니다.
