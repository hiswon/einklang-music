import { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// 이미지 샘플 (Unsplash 트렌디 음악 관련 이미지)
const HEADER_BG = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1200&auto=format&fit=crop'
const CLASS_IMG_1 = 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?q=80&w=800&auto=format&fit=crop' // Guitar
const CLASS_IMG_2 = 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?q=80&w=800&auto=format&fit=crop' // Piano
const CLASS_IMG_3 = 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?q=80&w=800&auto=format&fit=crop' // Vocal/MIDI

interface AcademyData {
  schedule: string
  curriculum: string
  events: string
  instructors: string
}

type TabType = 'about' | 'courses' | 'schedule' | 'instructors'

const defaultSchedule = `3월 15일/ 버스킹 정기 라이브
신정호 야외무대 오후 5시
참여 학생 리허설 오후 3시
;
3월 22일/ 1:1 맞춤 무료 청강 데이
보컬 & 통기타 파트 선착순 모집
전문 트레이너 1:1 진단
;
4월 05일/ 봄맞이 레코딩 세션
전문 스튜디오 음원 녹음 체험
개별 보컬/악기 파일 제공`

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('about')

  // 데이터 관리
  const [academyData, setAcademyData] = useState<AcademyData>({
    schedule: defaultSchedule,
    curriculum: '',
    events: '',
    instructors: ''
  })

  // 관리자 모드
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false)
  const [passwordInput, setPasswordInput] = useState<string>('')

  // 수정용 폼
  const [editForm, setEditForm] = useState<AcademyData>(academyData)

  // 1. Firebase 데이터 불러오기
  useEffect(() => {
    const fetchData = async () => {
      try {
        const docRef = doc(db, 'academy', 'data')
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
          const fetched = docSnap.data() as Partial<AcademyData>
          const loadedData: AcademyData = {
            schedule: fetched.schedule || defaultSchedule,
            curriculum: fetched.curriculum || '',
            events: fetched.events || '',
            instructors: fetched.instructors || ''
          }
          setAcademyData(loadedData)
          setEditForm(loadedData)
        }
      } catch (error) {
        console.error('Firebase 데이터 로딩 오류:', error)
      }
    }
    fetchData()
  }, [])

  // 비밀번호 확인
  const handleAdminLogin = () => {
    if (passwordInput === '1234') {
      setIsAdmin(true)
      setShowPasswordModal(false)
      setPasswordInput('')
      alert('관리자 모드로 로그인되었습니다.')
    } else {
      alert('비밀번호가 올바르지 않습니다.')
    }
  }

  // Firebase 데이터 저장
  const handleSaveData = async () => {
    try {
      await setDoc(doc(db, 'academy', 'data'), editForm)
      setAcademyData(editForm)
      alert('성공적으로 저장되었습니다!')
    } catch (error) {
      console.error('저장 실패:', error)
      alert('저장 중 오류가 발생했습니다.')
    }
  }

  // 데이터 파싱 함수 (제목/ 및 세미콜론; 파싱)
  const renderFormattedContent = (text: string) => {
    if (!text) return <p className="empty-text">등록된 내용이 없습니다.</p>

    const blocks = text.split(';').map(b => b.trim()).filter(Boolean)

    return (
      <div className="schedule-block-container">
        {blocks.map((block, idx) => {
          const slashIndex = block.indexOf('/')
          let title = ''
          let body = block

          if (slashIndex !== -1) {
            title = block.substring(0, slashIndex).trim()
            body = block.substring(slashIndex + 1).trim()
          }

          const lines = body
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)

          return (
            <div key={idx} className="date-group-card">
              {title && <div className="date-header">🎵 {title}</div>}
              <div className="date-content-list">
                {lines.map((line, lineIdx) => (
                  <div key={lineIdx} className="content-line">
                    <span className="detail-badge">{line}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="academy-container">
      {/* 헤더 */}
      <header className="academy-header">
        <div className="header-banner" style={{ backgroundImage: `url(${HEADER_BG})` }}>
          <div className="banner-overlay">
            <span className="badge-neon">EINKLANG MUSIC STUDIO</span>
            <h1>아인클랑 음악학원</h1>
            <p className="subtitle">나만의 감성을 연주하다 · 보컬 | 통기타 & 핑거스타일 | 미디 & 작곡</p>
          </div>
        </div>

        <div className="admin-bar">
          {!isAdmin ? (
            <button className="admin-btn" onClick={() => setShowPasswordModal(true)}>
              🔒 관리자 로그인
            </button>
          ) : (
            <button className="admin-btn logout" onClick={() => setIsAdmin(false)}>
              🔓 관리자 로그아웃
            </button>
          )}
        </div>
      </header>

      {/* 비밀번호 모달 */}
      {showPasswordModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>관리자 비밀번호 입력</h3>
            <input
              type="password"
              placeholder="비밀번호"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
            />
            <div className="modal-buttons">
              <button className="btn-confirm" onClick={handleAdminLogin}>확인</button>
              <button className="btn-cancel" onClick={() => setShowPasswordModal(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 네비게이션 탭 */}
      <nav className="academy-nav">
        <button className={activeTab === 'about' ? 'active' : ''} onClick={() => setActiveTab('about')}>
          학원소개
        </button>
        <button className={activeTab === 'courses' ? 'active' : ''} onClick={() => setActiveTab('courses')}>
          수강과목
        </button>
        <button className={activeTab === 'schedule' ? 'active' : ''} onClick={() => setActiveTab('schedule')}>
          이달의 일정
        </button>
        <button className={activeTab === 'instructors' ? 'active' : ''} onClick={() => setActiveTab('instructors')}>
          강사진
        </button>
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="academy-content">
        {/* 관리자 수정용 폼 */}
        {isAdmin && (
          <div className="admin-editor-box">
            <h3>✏️ 관리자 수강 및 일정 정보 수정</h3>
            <p className="admin-tip">
              💡 작성 팁: <code>제목/</code> 구분 후 줄바꿈, 세션 분할은 <code>;</code> 기호
            </p>
            <label>
              <strong>이달의 일정 / 버스킹:</strong>
              <textarea
                rows={5}
                value={editForm.schedule}
                onChange={(e) => setEditForm({ ...editForm, schedule: e.target.value })}
              />
            </label>
            <label>
              <strong>커리큘럼 공지:</strong>
              <textarea
                rows={4}
                value={editForm.curriculum}
                onChange={(e) => setEditForm({ ...editForm, curriculum: e.target.value })}
              />
            </label>
            <label>
              <strong>강사진 및 특강 세션:</strong>
              <textarea
                rows={4}
                value={editForm.instructors}
                onChange={(e) => setEditForm({ ...editForm, instructors: e.target.value })}
              />
            </label>
            <button className="save-btn" onClick={handleSaveData}>
              💾 변경사항 저장하기
            </button>
          </div>
        )}

        {/* 1. 학원소개 */}
        {activeTab === 'about' && (
          <section className="tab-content">
            <h2>🎧 아인클랑과 함께하는 음악 퍼포먼스</h2>
            <div className="video-container">
              <iframe
                src="https://www.youtube.com/embed/QzKwMGicdwU?list=RDQzKwMGicdwU"
                title="Piano Performance"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>

            <div className="quote-box">
              "음악은 말로 표현할 수 없는 것을 표현해 줍니다. 당신만의 소리를 찾아보세요."
            </div>

            <div className="section-block">
              <h2>🎹 스튜디오 시설 & 1:1 레슨룸</h2>
              <img src={CLASS_IMG_2} alt="피아노/미디 레슨실" className="content-img" />
              <p className="desc-text">
                방음 시설이 완비된 개인 연습실과 최고급 레코딩 장비를 갖추고 있습니다. 수강생 누구나 자유롭게 연습실 예약 이용이 가능합니다.
              </p>
            </div>

            {/* 빠른 신청 링크 */}
            <div className="link-section">
              <h3>상담 & 무료 체험 레슨</h3>
              <a 
                href="https://open.kakao.com" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="link-btn primary-link"
              >
                💬 1:1 카카오톡 오픈상담
              </a>
              <a 
                href="#apply" 
                onClick={() => alert('1:1 무료 체험 레슨 신청 폼 준비 중입니다.')} 
                className="link-btn secondary-link"
              >
                🎸 무료 체험 레슨 신청
              </a>
            </div>
          </section>
        )}

        {/* 2. 수강과목 */}
        {activeTab === 'courses' && (
          <section className="tab-content text-left">
            <h2>🎸 클래스 라인업</h2>
            <div className="course-grid">
              <div className="course-card">
                <img src={CLASS_IMG_1} alt="통기타 & 핑거스타일" />
                <div className="course-info">
                  <h3>통기타 & 핑거스타일</h3>
                  <p>기초 코드 반주부터 트렌디한 퍼커시브, 핑거스타일 솔로 연주까지 1:1 맞춤 지도</p>
                </div>
              </div>

              <div className="course-card">
                <img src={CLASS_IMG_3} alt="보컬 & 미디/작곡" />
                <div className="course-info">
                  <h3>보컬 & 미디 / 작곡 (Cubase, Logic)</h3>
                  <p>발성 기법부터 레코딩 수업, 나만의 자작곡 음원 제작까지 원스톱 프로세스</p>
                </div>
              </div>
            </div>

            {academyData.curriculum && (
              <div style={{ marginTop: '20px' }}>
                <h3>📋 커리큘럼 세부 공지</h3>
                {renderFormattedContent(academyData.curriculum)}
              </div>
            )}
          </section>
        )}

        {/* 3. 이달의 일정 */}
        {activeTab === 'schedule' && (
          <section className="tab-content text-left">
            <h2>📅 이달의 레슨 & 라이브 일정</h2>
            <img src={CLASS_IMG_3} alt="공연 현장" className="content-img" />
            {renderFormattedContent(academyData.schedule)}
          </section>
        )}

        {/* 4. 강사진 */}
        {activeTab === 'instructors' && (
          <section className="tab-content text-left">
            <h2>👥 프로 아티스트 강사진</h2>
            <div className="instructor-badge-box">
              <p>✨ 현역 필드 뮤지션 및 실용음악 전공 강사진으로 구성되어 있습니다.</p>
            </div>
            {renderFormattedContent(
              academyData.instructors ||
              `통기타/핑거스타일/ 원장 실용음악과 아쿠스틱 기타 전공\n현 버스킹 팀 리더\n개인별 맞춤 악보 제작 연주법 지도
              ;
              보컬 트레이닝/ 보컬 수석 강사\n음원 발매 및 대중음악 트레이너 경험\n녹음식 레코딩 수업 병행`
            )}
          </section>
        )}
      </main>

      <footer className="academy-footer">
        <p>© 2026 Vibe Music Academy. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default App