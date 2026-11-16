# Ekran ve rota haritası

Uygulamanın gerçekten ulaşılabilir ekranları. Başka bir ekran bulursanız ölü koddur:
`npm run unused:modules` (`--strict` ile hata verir) `src/main.jsx`'ten ulaşılamayan dosyaları listeler.

| Hash rotası | Görünüm (`route.view`) | Sayfa |
| --- | --- | --- |
| `#/` | `home` | `src/pages/HomeDashboard.jsx` |
| `#/dersler` | `list` | `src/pages/Courses.jsx` |
| `#/dersler/:id` | `course` | `src/pages/CourseDetail.jsx` |
| `#/dersler/:id/calisma` | `workspace` | `src/pages/Workspace.jsx` |
| `#/dersler/:id/ogrenme` | `learning` | `src/pages/LearningWorkspace.jsx` |
| `#/dersler/:id/videolar` | `videos` | `src/pages/Videos.jsx` |
| `#/dersler/:id/quiz`, `#/quiz` | `quiz` | `src/pages/CourseQuiz.jsx` |
| `#/dersler/:id/sinavlar` | `exams` | `src/pages/CourseExams.jsx` |
| `#/analitik` | `analytics` | `src/pages/LearningAnalytics.jsx` |

Rota ayrıştırma: `parseHash` (`src/app/store.jsx`). Ağır sayfalar `React.lazy` ile ayrı parça olarak yüklenir (`src/App.jsx`).

## Kaldırılanlar
Eski örnek-veri ekranları (`Home`, `Quiz`, `Analytics`), `data/mock.js`, `lib/docs.js`, `Toast`, `Diagrams`,
`NextSteps`, `Threads` ve `components/analytics/*` hiçbir rotadan ulaşılamıyordu; git geçmişinde durur.
`data/academic.js` canlı ekranlarca (store, CourseDetail, StatusTrack) hâlâ kullanıldığı için yerinde.
`recharts` bağımlılığı artık kullanılmıyor; kilit dosyası güncellemesiyle ayrıca kaldırılabilir.
