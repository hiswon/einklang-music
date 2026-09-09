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

interface Comment {
  id: string
  author: string
  password: string
  text: string
  createdAt: string
}

interface Post {
  id: string
  title: string
  password: string
  content: string
  createdAt: string
  likes: number
  comments: Comment[]
}

type TabType = 'about' | 'courses' | 'schedule' | 'instructors' | 'board'

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

// 1. 구글 드라이브 링크에서 파일 ID 추출하는 유틸리티 함수 추가
function extractGoogleDriveId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// 유틸리티: 유튜브 URL에서 Video ID 추출
function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/
  const match = url.match(regExp)
  return match && match[2].length === 11 ? match[2] : null
}

// 2. 유틸리티: 이미지 URL 판단 (구글 드라이브 링크 포함하도록 확장)
function isImageUrl(url: string): boolean {
  return (
    /\.(jpeg|jpg|gif|png|webp)$/i.test(url) ||
    url.includes('images.unsplash.com') ||
    url.includes('imgur.com') ||
    url.includes('drive.google.com') // 구글 드라이브 주소 감지
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('about')

  // 데이터 관리
  const [academyData, setAcademyData] = useState<AcademyData>({
    schedule: defaultSchedule,
    curriculum: '',
    events: '',
    instructors: ''
  })

  // 게시글 관리
  const [posts, setPosts] = useState<Post[]>([])

  // 글 작성 폼 열림/닫힘 상태
  const [showWriteForm, setShowWriteForm] = useState<boolean>(false)

  // 게시글 작성 폼 입력값
  const [newTitle, setNewTitle] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newContent, setNewContent] = useState('')

  // 이중 플레이 방지: 현재 재생 중인 게시물 ID
  const [playingPostId, setPlayingPostId] = useState<string | null>(null)

  // 좋아요 클릭 상태 저장 (로컬 보관용)
  const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({})

  // 게시글 삭제 모달
  const [deleteModalPostId, setDeleteModalPostId] = useState<string | null>(null)
  const [deletePasswordInput, setDeletePasswordInput] = useState('')

  // 댓글 삭제 모달
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<{ postId: string; commentId: string } | null>(null)
  const [deleteCommentPasswordInput, setDeleteCommentPasswordInput] = useState('')

  // 댓글 입력 상태 (작성자, 암호, 내용)
  const [commentInputs, setCommentInputs] = useState<Record<string, { author: string; password: string; text: string }>>({})

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
          const fetched = docSnap.data() as Partial<AcademyData> & { posts?: Post[] }
          const loadedData: AcademyData = {
            schedule: fetched.schedule || defaultSchedule,
            curriculum: fetched.curriculum || '',
            events: fetched.events || '',
            instructors: fetched.instructors || ''
          }
          setAcademyData(loadedData)
          setEditForm(loadedData)
          if (fetched.posts) {
            setPosts(fetched.posts)
          }
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

  // Firebase 데이터 저장 (학원 정보 + 게시판 목록)
  const saveAllToFirebase = async (updatedAcademyData: AcademyData, updatedPosts: Post[]) => {
    try {
      await setDoc(doc(db, 'academy', 'data'), {
        ...updatedAcademyData,
        posts: updatedPosts
      })
    } catch (error) {
      console.error('Firebase 저장 실패:', error)
    }
  }

  const handleSaveData = async () => {
    await saveAllToFirebase(editForm, posts)
    setAcademyData(editForm)
    alert('성공적으로 저장되었습니다!')
  }

  // 게시글 작성 등록
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim() || !newPassword.trim() || !newContent.trim()) {
      alert('제목, 암호, 내용을 모두 입력해 주세요.')
      return
    }

    const newPost: Post = {
      id: Date.now().toString(),
      title: newTitle.trim(),
      password: newPassword.trim(),
      content: newContent.trim(),
      createdAt: new Date().toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),
      likes: 0,
      comments: []
    }

    const updatedPosts = [newPost, ...posts]
    setPosts(updatedPosts)
    setNewTitle('')
    setNewPassword('')
    setNewContent('')
    setShowWriteForm(false) // 작성 완료 후 폼 닫기

    await saveAllToFirebase(academyData, updatedPosts)
    alert('게시글이 성공적으로 등록되었습니다.')
  }

  // 게시글 삭제 처리
  const handleDeletePost = async () => {
    if (!deleteModalPostId) return

    const targetPost = posts.find(p => p.id === deleteModalPostId)
    if (!targetPost) return

    if (deletePasswordInput === targetPost.password || deletePasswordInput === '1234' || isAdmin) {
      const updatedPosts = posts.filter(p => p.id !== deleteModalPostId)
      setPosts(updatedPosts)
      setDeleteModalPostId(null)
      setDeletePasswordInput('')
      await saveAllToFirebase(academyData, updatedPosts)
      alert('게시글이 삭제되었습니다.')
    } else {
      alert('암호가 올바르지 않습니다.')
    }
  }

  // 좋아요 토글
  const handleToggleLike = async (postId: string) => {
    const isLiked = !!likedPosts[postId]
    const updatedPosts = posts.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          likes: isLiked ? Math.max(0, p.likes - 1) : p.likes + 1
        }
      }
      return p
    })

    setPosts(updatedPosts)
    setLikedPosts(prev => ({ ...prev, [postId]: !isLiked }))
    await saveAllToFirebase(academyData, updatedPosts)
  }

  // 댓글 입력 상태 업데이트
  const handleCommentInputChange = (postId: string, field: 'author' | 'password' | 'text', value: string) => {
    setCommentInputs(prev => ({
      ...prev,
      [postId]: {
        ...(prev[postId] || { author: '', password: '', text: '' }),
        [field]: value
      }
    }))
  }

  // 댓글 등록
  const handleAddComment = async (postId: string) => {
    const input = commentInputs[postId]
    if (!input || !input.author.trim() || !input.password.trim() || !input.text.trim()) {
      alert('작성자, 암호, 댓글 내용을 모두 입력하세요.')
      return
    }

    const newComment: Comment = {
      id: Date.now().toString(),
      author: input.author.trim(),
      password: input.password.trim(),
      text: input.text.trim(),
      createdAt: new Date().toLocaleDateString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    const updatedPosts = posts.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          comments: [...(p.comments || []), newComment]
        }
      }
      return p
    })

    setPosts(updatedPosts)
    setCommentInputs(prev => ({
      ...prev,
      [postId]: { author: '', password: '', text: '' }
    }))
    await saveAllToFirebase(academyData, updatedPosts)
  }

  // 댓글 삭제 처리
  const handleDeleteComment = async () => {
    if (!deleteCommentTarget) return
    const { postId, commentId } = deleteCommentTarget

    const targetPost = posts.find(p => p.id === postId)
    const targetComment = targetPost?.comments?.find(c => c.id === commentId)

    if (!targetComment) return

    if (deleteCommentPasswordInput === targetComment.password || deleteCommentPasswordInput === '1234' || isAdmin) {
      const updatedPosts = posts.map(p => {
        if (p.id === postId) {
          return {
            ...p,
            comments: p.comments.filter(c => c.id !== commentId)
          }
        }
        return p
      })

      setPosts(updatedPosts)
      setDeleteCommentTarget(null)
      setDeleteCommentPasswordInput('')
      await saveAllToFirebase(academyData, updatedPosts)
      alert('댓글이 삭제되었습니다.')
    } else {
      alert('댓글 암호가 올바르지 않습니다.')
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

  // 3. 게시글 파싱 및 렌더링 함수 수정
  const renderPostContent = (postId: string, content: string) => {
    const tokens = content.split(/\s+/)
    const youtubeUrls: string[] = []
    const imageUrls: string[] = []

    tokens.forEach(token => {
      if (extractYouTubeId(token)) {
        youtubeUrls.push(token)
      } else if (isImageUrl(token)) {
        // 구글 드라이브 링크인 경우, 직접 이미지 출력이 가능한 URL 형태로 변환
        if (token.includes('drive.google.com')) {
          const driveId = extractGoogleDriveId(token)
          if (driveId) {
            imageUrls.push(`https://lh3.googleusercontent.com/d/${driveId}`)
          }
        } else {
          imageUrls.push(token)
        }
      }
    })

    // 본문에서 유튜브 및 이미지 URL 텍스트 지우기 (텍스트가 튀어나오는 현상 방지)
    const youtubeRegex = /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/g
    const driveRegex = /(https?:\/\/)?drive\.google\.com\/[^\s]+/g
    const directImgRegex = /(https?:\/\/[^\s]+?\.(?:jpeg|jpg|gif|png|webp))/g

    const cleanContent = content
      .replace(youtubeRegex, '')
      .replace(driveRegex, '')
      .replace(directImgRegex, '')
      .trim()

    const isPlaying = playingPostId === postId

    return (
      <div className="post-parsed-content">
        {/* 유튜브 영상 영역 */}
        {youtubeUrls.length > 0 && (
          <div className="post-media-box">
            {youtubeUrls.map((url, idx) => {
              const videoId = extractYouTubeId(url)
              if (!videoId) return null

              return (
                <div key={idx} className="youtube-player-wrapper">
                  {isPlaying ? (
                    <div className="video-container">
                      <iframe
                        src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
                        title={`YouTube Video ${idx}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      ></iframe>
                    </div>
                  ) : (
                    <div className="youtube-thumbnail-container" onClick={() => setPlayingPostId(postId)}>
                      <img
                        src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                        alt="유튜브 썸네일"
                        className="yt-thumbnail"
                      />
                      <button className="play-overlay-btn" type="button">
                        ▶ 영상 재생하기
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 이미지 영역 (구글 드라이브 사진 포함) */}
        {imageUrls.length > 0 && (
          <div className="post-images-grid">
            {imageUrls.map((url, idx) => (
              <img key={idx} src={url} alt={`업로드 이미지 ${idx}`} className="post-embed-img" />
            ))}
          </div>
        )}

        {/* 정제된 글 본문만 출력 */}
        {cleanContent && <p className="post-text-body">{cleanContent}</p>}
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

      {/* 관리자 비밀번호 모달 */}
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

      {/* 게시글 삭제 모달 */}
      {deleteModalPostId && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>게시글 삭제</h3>
            <p className="modal-desc">작성 시 설정한 암호 또는 관리자 암호를 입력하세요.</p>
            <input
              type="password"
              placeholder="암호 입력"
              value={deletePasswordInput}
              onChange={(e) => setDeletePasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDeletePost()}
            />
            <div className="modal-buttons">
              <button className="btn-danger" onClick={handleDeletePost}>삭제하기</button>
              <button className="btn-cancel" onClick={() => {
                setDeleteModalPostId(null)
                setDeletePasswordInput('')
              }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 댓글 삭제 모달 */}
      {deleteCommentTarget && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>댓글 삭제</h3>
            <p className="modal-desc">댓글 작성 시 입력한 암호 또는 관리자 암호를 입력하세요.</p>
            <input
              type="password"
              placeholder="댓글 암호 입력"
              value={deleteCommentPasswordInput}
              onChange={(e) => setDeleteCommentPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDeleteComment()}
            />
            <div className="modal-buttons">
              <button className="btn-danger" onClick={handleDeleteComment}>삭제하기</button>
              <button className="btn-cancel" onClick={() => {
                setDeleteCommentTarget(null)
                setDeleteCommentPasswordInput('')
              }}>취소</button>
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
        <button className={activeTab === 'board' ? 'active' : ''} onClick={() => setActiveTab('board')}>
          게시판
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
              <a 
                href="https://www.instagram.com/einklang.music/" 
                className="link-btn secondary-link"
              >
                🎸 인스타그램
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

        {/* 5. 게시판 */}
        {activeTab === 'board' && (
          <section className="tab-content text-left">
            <div className="board-top-header">
              <h2>📋 음악학원 자유 게시판</h2>
              <button
                className="toggle-write-btn"
                onClick={() => setShowWriteForm(!showWriteForm)}
              >
                {showWriteForm ? '❌ 작성 창 닫기' : '✍️ 새 게시글 작성'}
              </button>
            </div>

            {/* 평소에는 닫혀 있다가 버튼 클릭 시 펼쳐지는 작성 폼 */}
            {showWriteForm && (
              <form className="post-create-form" onSubmit={handleCreatePost}>
                <h3>✍️ 새 게시글 작성하기</h3>
                <div className="form-row">
                  <input
                    type="text"
                    placeholder="제목"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="input-field"
                    required
                  />
                  <input
                    type="password"
                    placeholder="암호"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field pass-field"
                    required
                  />
                </div>
                <textarea
                  rows={4}
                  placeholder="내용을 입력하세요. (유튜브 주소나 사진 URL을 포함할 수 있습니다)"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="input-field text-area"
                  required
                />
                <button type="submit" className="submit-post-btn">
                  📌 게시글 등록하기
                </button>
              </form>
            )}

            {/* 게시글 목록 */}
            <div className="posts-list">
              {posts.length === 0 ? (
                <div className="empty-posts">
                  등록된 게시물이 없습니다. 상단의 버튼을 눌러 첫 번째 글을 작성해 보세요!
                </div>
              ) : (
                posts.map(post => {
                  const isLiked = !!likedPosts[post.id]
                  const currInput = commentInputs[post.id] || { author: '', password: '', text: '' }

                  return (
                    <article key={post.id} className="post-card">
                      <div className="post-header">
                        <div className="post-header-main">
                          <h3 className="post-title">{post.title}</h3>
                          <span className="post-date">{post.createdAt}</span>
                        </div>
                        <button
                          className="delete-btn"
                          onClick={() => setDeleteModalPostId(post.id)}
                        >
                          🗑️ 삭제
                        </button>
                      </div>

                      {/* 유튜브/사진/텍스트 파싱 본문 */}
                      {renderPostContent(post.id, post.content)}

                      {/* 좋아요 및 반응 바 */}
                      <div className="post-action-bar">
                        <button
                          className={`like-btn ${isLiked ? 'liked' : ''}`}
                          onClick={() => handleToggleLike(post.id)}
                        >
                          {isLiked ? '❤️' : '🤍'} 좋아요 {post.likes}
                        </button>
                      </div>

                      {/* 댓글 창 */}
                      <div className="comments-section">
                        <h4>💬 댓글 ({post.comments?.length || 0})</h4>
                        
                        {/* 댓글 입력 폼 */}
                        <div className="comment-form-grid">
                          <div className="comment-inputs-top">
                            <input
                              type="text"
                              placeholder="작성자"
                              value={currInput.author}
                              onChange={(e) => handleCommentInputChange(post.id, 'author', e.target.value)}
                              className="comment-sub-input"
                            />
                            <input
                              type="password"
                              placeholder="댓글 암호"
                              value={currInput.password}
                              onChange={(e) => handleCommentInputChange(post.id, 'password', e.target.value)}
                              className="comment-sub-input"
                            />
                          </div>
                          <div className="comment-inputs-bottom">
                            <input
                              type="text"
                              placeholder="댓글 내용..."
                              value={currInput.text}
                              onChange={(e) => handleCommentInputChange(post.id, 'text', e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddComment(post.id)}
                              className="comment-text-input"
                            />
                            <button
                              type="button"
                              className="add-comment-btn"
                              onClick={() => handleAddComment(post.id)}
                            >
                              등록
                            </button>
                          </div>
                        </div>

                        {/* 댓글 목록 */}
                        {post.comments && post.comments.length > 0 && (
                          <div className="comments-list">
                            {post.comments.map(c => (
                              <div key={c.id} className="comment-item">
                                <div className="comment-main-info">
                                  <div className="comment-header-row">
                                    <span className="comment-author">{c.author}</span>
                                    <span className="comment-date">{c.createdAt}</span>
                                  </div>
                                  <div className="comment-text">{c.text}</div>
                                </div>
                                <button
                                  type="button"
                                  className="comment-del-btn"
                                  onClick={() => setDeleteCommentTarget({ postId: post.id, commentId: c.id })}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="academy-footer">
        <p>© 2026 Einklang Music Academy. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default App