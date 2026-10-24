import { useEffect } from 'react'
import { X } from 'lucide-react'

const GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: '어디서나', keys: [['⌘K', '명령 팔레트'], ['⌘1 / ⌘2', '캔버스 / 리뷰'], ['⌘3', '에이전트 패널 열고 닫기'], ['⌘.', '포커스'], ['⌘L', '입력창으로'], ['⌘⇧O', '새 대화'], ['esc', '에이전트 중단'], ['?', '이 도움말']] },
  { title: '대화', keys: [['⏎ / ⇧⏎', '보내기 / 줄바꿈'], ['/', '슬래시 명령'], ['@', '파일을 대화에 붙이기'], ['1 / 2 / 3', '승인: Allow / Always allow / Deny']] },
  { title: '리뷰', keys: [['j / k', '다음 / 이전 파일'], ['n / p', '다음 / 이전 hunk'], ['v', 'Viewed 표시하고 다음 파일로'], ['u / s', 'Unified / Split'], ['w', 'Hide whitespace changes'], ['/ 또는 ⌘F', '이 파일에서 찾기'], ['m', '파일 / 코멘트 탭'], ['r', 'Refresh'], ['줄 번호 드래그', '여러 줄에 코멘트'], ['⌘⏎', '코멘트 바로 보내기']] },
  { title: '캔버스', keys: [['클릭', '선택'], ['더블클릭', '상자·패키지: 그 부분으로 확대 / 빈 곳: Zoom to fit'], ['마우스 올리기', '확대 버튼, 패키지는 접기·펼치기 버튼'], ['f', 'Zoom to fit'], ['+ / −', 'Zoom in / Zoom out'], ['휠', '커서 위치로 확대·축소'], ['⇧ + 휠', '화면 이동'], ['i', '정보 카드'], ['esc', '선택 해제']] },
]

export function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="shortcuts" role="dialog">
        <header><b>단축키</b><span className="grow" /><button className="iconbtn" onClick={onClose}><X size={14} /></button></header>
        <div className="shortcut-grid">
          {GROUPS.map(g => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              {g.keys.map(([k, v]) => <div key={k} className="sk"><span className="keys">{k.split(' / ').map((x, i) => <kbd key={i}>{x}</kbd>)}</span><span>{v}</span></div>)}
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
