# Smart7

HARIO Smart7 BT (`EVS-70SV-BT`)를 블루투스로 제어하는 비공식 웹앱입니다.

[웹앱 열기](https://smart7-offline.vercel.app/) · [설명서 PDF](https://smart7-offline.vercel.app/EVS-70SV-BT-manual.pdf) · [커뮤니티 게시판](https://github.com/OneTop4458/smart7-offline/issues?q=is%3Aissue%20is%3Aopen%20label%3Arecipe)

## 시작하기

Android Chrome에서 **BT 연결**을 누르고 본체에 표시된 6자리 PIN을 입력하세요. Web Bluetooth를 지원하는 데스크톱 Chrome에서도 연결할 수 있습니다. iPhone·iPad에서는 레시피를 둘러볼 수 있습니다.

- **자동 모드**와 **내 레시피**에서 추출을 시작할 수 있습니다. 내 레시피는 사진과 함께 저장하고 JSON으로 백업할 수 있습니다.
- **공개 레시피**에는 예전 공유 레시피 19종과 실시간 커뮤니티 게시판이 있습니다.

## 커뮤니티

공개 레시피에서 새 글을 작성하거나 내 레시피에서 추출 설정을 첨부할 수 있습니다. GitHub에서 로그인하고 게시하면 열린 이슈가 웹앱에 표시됩니다. 글과 댓글은 웹앱에서 읽고, 답글은 GitHub에서 작성합니다.

운영자는 GitHub에서 이슈를 닫아 게시판에서 숨길 수 있습니다. 목록을 새로고침하면 반영됩니다.

## 개발

```sh
npm test
python -m http.server 8080 --directory public
```

[localhost:8080](http://localhost:8080)에서 엽니다. `main`에 반영하면 Vercel이 배포합니다.

## 라이선스

프로젝트 코드는 [MIT](LICENSE)입니다. 사진과 HARIO 자료의 출처 및 이용 조건은 [제3자 자료 안내](THIRD_PARTY_NOTICES.md)를 참고하세요.
