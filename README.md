# Smart7

HARIO Smart7 BT (`EVS-70SV-BT`)를 블루투스로 제어하는 비공식 웹앱입니다.

[웹앱 열기](https://smart7-offline.vercel.app/) · [설명서 PDF](https://smart7-offline.vercel.app/EVS-70SV-BT-manual.pdf) · [커뮤니티 게시판](https://github.com/OneTop4458/smart7-offline/issues?q=is%3Aissue%20is%3Aopen%20label%3Arecipe)

## 시작하기

Android Chrome에서 **BT 연결**을 누르고 본체에 표시된 6자리 PIN을 입력하세요. Web Bluetooth를 지원하는 데스크톱 Chrome에서도 연결할 수 있습니다. iPhone·iPad에서는 레시피를 둘러볼 수 있습니다.

- **자동 모드**와 **내 레시피**에서 추출을 시작할 수 있습니다. 내 레시피는 사진과 함께 저장하고 JSON으로 백업할 수 있습니다.
- **공개 레시피**는 예전 공유 레시피 19종과 사용자 레시피를 GitHub 이슈에서 읽습니다.

## 커뮤니티

**레시피 공유**에서 내 레시피를 고르면 원두와 분쇄도를 불러옵니다. 저장한 사진을 내려받아 GitHub 게시 화면의 **사진** 항목에 첨부할 수 있습니다. 공개 목록과 상세 화면에 첨부 사진이 표시되며, 답글은 각 이슈에서 작성합니다.

보존 레시피는 앱의 한국어, 영어, 일본어 설정에 맞춰 표시합니다. 사용자 게시글은 작성된 언어로 표시합니다.

운영자는 GitHub에서 이슈를 닫아 게시판에서 숨길 수 있습니다. 목록을 새로고침하면 반영됩니다.

## 개발

```sh
npm test
python -m http.server 8080 --directory public
```

[localhost:8080](http://localhost:8080)에서 엽니다. GitHub Actions는 PR과 `main` 변경을 테스트합니다. Vercel은 `main`의 빌드에서 테스트를 통과하면 운영 배포합니다.

## 라이선스

프로젝트 코드는 [MIT](LICENSE)입니다. 사진과 HARIO 자료의 출처 및 이용 조건은 [제3자 자료 안내](THIRD_PARTY_NOTICES.md)를 참고하세요.
