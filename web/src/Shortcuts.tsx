import { useEffect } from 'react'
import { X } from 'lucide-react'
import { LINK_KEY, NAV_KEYS } from './canvas/CodePane.tsx'

const GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: '어디서나', keys: [['⌘K', '명령 팔레트'], ['⌘1 / ⌘2', '지도 / 리뷰'], ['⌘L', '지도 위 입력창으로'], ['?', '이 도움말']] },
  { title: '지도 위 입력창', keys: [['⏎ / ⇧⏎', '터미널에 보내기 / 줄바꿈'], ['@', '파일을 붙이기']] },
  { title: '리뷰', keys: [['j / k', '다음 / 이전 파일'], ['n / p', '다음 / 이전 hunk'], ['v', 'Viewed 표시하고 다음 파일로'], ['u / s', 'Unified / Split'], ['w', 'Hide whitespace changes'], ['/ 또는 ⌘F', '이 파일에서 찾기'], ['m', '파일 / 코멘트 탭'], ['r', 'Refresh'], ['줄 번호 드래그', '여러 줄에 코멘트'], ['⌘⏎', '코멘트 바로 보내기']] },
  { title: '캔버스', keys: [['클릭', '선택'], ['더블클릭', '상자·패키지: 그 부분으로 확대 / 빈 곳: Zoom to fit'], ['패키지 오른쪽 위 버튼', '그 패키지 접기·펼치기'], ['f', 'Zoom to fit'], ['+ / −', 'Zoom in / Zoom out'], ['휠', '커서 위치로 확대·축소'], ['⇧ + 휠', '화면 이동'], ['n · p', '흐름의 다음 · 이전 단계'], ['c', '코드 칸: 누른 상자의 코드를 옆에서 보기'], ['코드 칸에서 ⌘ + 휠', '코드만 확대·축소'], ['코드 칸에서 단어 클릭', '같은 단어를 파일 전체에서 강조'], [`${LINK_KEY} + 클릭`, '코드 칸에서 지도에 그려진 이름: 그 선언으로, 지도에서도 그 부분으로'], [NAV_KEYS.join(' / '), '코드 칸: 뒤로 / 앞으로 (마우스의 뒤로·앞으로 버튼도)'], ['esc', '선택 해제']] },
  { title: '결정 모드 (레일의 결정, 지도 제목 뒤 결정 칩)', keys: [['1 · 2 · 3', '선택지 고르기'], ['⏎', '고른 쪽으로 정하고 다음 결정'], ['l', '나중에'], ['q', '고른 선택지에 대해 Claude에게 묻기'], ['esc', '결정 모드 닫기']] },
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
