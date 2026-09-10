import React, { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { QRCodeSVG } from 'qrcode.react'
import { Html5QrcodeScanner } from 'html5-qrcode'

const HEADER_BG = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1200&auto=format&fit=crop'
const CLASS_IMG_1 = 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?q=80&w=800&auto=format&fit=crop'
//const CLASS_IMG_2 = 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?q=80&w=800&auto=format&fit=crop'
const CLASS_IMG_3 = 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?q=80&w=800&auto=format&fit=crop'

interface AcademyData {
  schedule: string
  curriculum: string
  events: string
  instructors: string
}

interface User {
  id: string
  password: string
  name: string
  reason: string
  role: 'ADMIN' | 'USER'
}

interface AttendanceRecord {
  id: string
  userId: string
  userName: string
  date: string // YYYY-MM-DD
  checkIn: string // HH:mm:ss
  checkOut?: string // HH:mm:ss
  timestamp: number
}

interface Comment {
  id: string
  author: string
  text: string
  createdAt: string
}

interface Post {
  id: string
  authorId: string
  authorName: string
  title: string
  content: string
  createdAt: string
  likes: number
  comments: Comment[]
}

type TabType = 'about' | 'courses' | 'schedule' | 'instructors' | 'board' | 'attendance' | 'qr'

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

// 고정 관리자 정보
const ADMIN_ACCOUNTS: User[] = [
  { id: 'jin', password: '12345', name: 'jin', reason: '관리자 계정', role: 'ADMIN' },
  { id: 'rang', password: '67890', name: 'rang', reason: '관리자 계정', role: 'ADMIN' }
]

function extractGoogleDriveId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/
  const match = url.match(regExp)
  return match && match[2].length === 11 ? match[2] : null
}

function isImageUrl(url: string): boolean {
  return (
    /\.(jpeg|jpg|gif|png|webp)$/i.test(url) ||
    url.includes('images.unsplash.com') ||
    url.includes('imgur.com') ||
    url.includes('drive.google.com')
  )
}

// 주차 계산 유틸리티
function getWeekNumber(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('about')

  // 상태 관리
  const [academyData, setAcademyData] = useState<AcademyData>({
    schedule: defaultSchedule,
    curriculum: '',
    events: '',
    instructors: ''
  })
  const [posts, setPosts] = useState<Post[]>([])
  const [users, setUsers] = useState<User[]>(ADMIN_ACCOUNTS)
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])

  // 현재 로그인 사용자
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  // 로그인 & 회원가입 모달
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false)
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN')
  const [loginId, setLoginId] = useState('')
  const [loginPw, setLoginPw] = useState('')
  
  // 회원가입 폼
  const [regId, setRegId] = useState('')
  const [regPw, setRegPw] = useState('')
  const [regName, setRegName] = useState('')
  const [regReason, setRegReason] = useState('')

  // 게시글 작성
  const [showWriteForm, setShowWriteForm] = useState<boolean>(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')

  // 플레이어 및 댓글 입력
  const [playingPostId, setPlayingPostId] = useState<string | null>(null)
  //const [likedPosts, setLikedPosts] = useState<Record<string, boolean>>({})
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({})

  // 관리자 수정용 폼
  const [editForm, setEditForm] = useState<AcademyData>(academyData)

  // 관리자 출석조회 필터
  const [filterMode, setFilterMode] = useState<'ALL' | 'DAILY' | 'WEEKLY'>('ALL')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])

  // Firebase 초기 로딩
  useEffect(() => {
    const fetchData = async () => {
      try {
        const docRef = doc(db, 'academy', 'data')
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
          const fetched = docSnap.data() as any
          const loadedData: AcademyData = {
            schedule: fetched.schedule || defaultSchedule,
            curriculum: fetched.curriculum || '',
            events: fetched.events || '',
            instructors: fetched.instructors || ''
          }
          setAcademyData(loadedData)
          setEditForm(loadedData)
          if (fetched.posts) setPosts(fetched.posts)
          if (fetched.users) {
            // 기본 고정 관리자와 DB 사용자 병합
            const mergedUsers = [...ADMIN_ACCOUNTS]
            fetched.users.forEach((u: User) => {
              if (!mergedUsers.find(exist => exist.id === u.id)) {
                mergedUsers.push(u)
              }
            })
            setUsers(mergedUsers)
          }
          if (fetched.attendances) setAttendances(fetched.attendances)
        }
      } catch (error) {
        console.error('Firebase 로딩 실패:', error)
      }
    }
    fetchData()
  }, [])

  // Firebase 동기화
  const saveDataToFirebase = async (
    data = academyData,
    pList = posts,
    uList = users,
    aList = attendances
  ) => {
    try {
      await setDoc(doc(db, 'academy', 'data'), {
        ...data,
        posts: pList,
        users: uList.filter(u => u.role !== 'ADMIN'), // 일반 사용자만 DB 저장
        attendances: aList
      })
    } catch (e) {
      console.error('Firebase 저장 오류:', e)
    }
  }

  // 로그인 처리
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    const target = users.find(u => u.id === loginId && u.password === loginPw)
    if (target) {
      setCurrentUser(target)
      setShowAuthModal(false)
      setLoginId('')
      setLoginPw('')
      alert(`${target.name}님 환영합니다!`)
    } else {
      alert('아이디 또는 비밀번호가 올바르지 않습니다.')
    }
  }

  // 회원가입 처리
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regId || !regPw || !regName || !regReason) {
      alert('모든 필드를 입력해 주세요.')
      return
    }
    if (users.some(u => u.id === regId)) {
      alert('이미 존재하는 아이디입니다.')
      return
    }

    const newUser: User = {
      id: regId.trim(),
      password: regPw.trim(),
      name: regName.trim(),
      reason: regReason.trim(),
      role: 'USER'
    }

    const updatedUsers = [...users, newUser]
    setUsers(updatedUsers)
    setCurrentUser(newUser)
    setShowAuthModal(false)

    setRegId(''); setRegPw(''); setRegName(''); setRegReason('')
    await saveDataToFirebase(academyData, posts, updatedUsers, attendances)
    alert('회원가입이 완료되었습니다!')
  }

  // 로그아웃
  const handleLogout = () => {
    setCurrentUser(null)
    setActiveTab('about')
    alert('로그아웃 되었습니다.')
  }

  // QR 출석 처리 함수 (오늘 첫 스캔 -> 등원, 두번째 -> 하원)
  const processAttendance = async (scannedUserId: string) => {
    const student = users.find(u => u.id === scannedUserId)
    if (!student) {
      alert('존재하지 않는 회원 정보입니다.')
      return
    }

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0] // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0] // HH:mm:ss

    // 오늘 스캔 기록 조회
    const existingIndex = attendances.findIndex(
      a => a.userId === scannedUserId && a.date === todayStr
    )

    let updatedList = [...attendances]

    if (existingIndex === -1) {
      // 1) 오늘 첫 번째 찍힘 -> 등원
      const newRec: AttendanceRecord = {
        id: Date.now().toString(),
        userId: student.id,
        userName: student.name,
        date: todayStr,
        checkIn: timeStr,
        timestamp: now.getTime()
      }
      updatedList.unshift(newRec)
      alert(`[등원 완료] ${student.name}님 등원 시간: ${timeStr}`)
    } else {
      // 2) 오늘 두 번째 찍힘 -> 하원
      const targetRec = updatedList[existingIndex]
      if (targetRec.checkOut) {
        alert(`${student.name}님은 이미 오늘 하원까지 완료 처리되었습니다.`)
        return
      }
      updatedList[existingIndex] = {
        ...targetRec,
        checkOut: timeStr
      }
      alert(`[하원 완료] ${student.name}님 하원 시간: ${timeStr}`)
    }

    setAttendances(updatedList)
    await saveDataToFirebase(academyData, posts, users, updatedList)
  }

  // 관리자용 QR 스캐너 컴포넌트 내부 효과
  useEffect(() => {
    if (activeTab === 'qr' && currentUser?.role === 'ADMIN') {
      const scanner = new Html5QrcodeScanner(
        'qr-reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      )

      scanner.render(
        (decodedText) => {
          try {
            const data = JSON.parse(decodedText)
            if (data.studentId) {
              processAttendance(data.studentId)
              scanner.clear()
            }
          } catch (e) {
            console.error('유효하지 않은 QR 코드입니다.')
          }
        },
        () => {}
      )

      return () => {
        scanner.clear().catch(() => {})
      }
    }
  }, [activeTab, currentUser])

  // 게시글 작성
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return
    if (!newTitle.trim() || !newContent.trim()) {
      alert('제목과 내용을 입력해 주세요.')
      return
    }

    const newPost: Post = {
      id: Date.now().toString(),
      authorId: currentUser.id,
      authorName: currentUser.name,
      title: newTitle.trim(),
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
    setNewContent('')
    setShowWriteForm(false)

    await saveDataToFirebase(academyData, updatedPosts, users, attendances)
    alert('게시글이 등록되었습니다.')
  }

  // 게시글 삭제
  const handleDeletePost = async (post: Post) => {
    if (!currentUser) return
    if (currentUser.role === 'ADMIN' || currentUser.id === post.authorId) {
      if (window.confirm('정말 삭제하시겠습니까?')) {
        const updated = posts.filter(p => p.id !== post.id)
        setPosts(updated)
        await saveDataToFirebase(academyData, updated, users, attendances)
      }
    } else {
      alert('본인이 작성한 글만 삭제할 수 있습니다.')
    }
  }

  // 댓글 등록 (최신 댓글이 위로 쌓이도록 unshift)
  const handleAddComment = async (postId: string) => {
    if (!currentUser) {
      alert('로그인이 필요합니다.')
      return
    }
    const text = commentInputs[postId]?.trim()
    if (!text) return

    const newComment: Comment = {
      id: Date.now().toString(),
      author: currentUser.name,
      text: text,
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
          comments: [newComment, ...(p.comments || [])] // 최신 댓글을 맨 앞에 추가
        }
      }
      return p
    })

    setPosts(updatedPosts)
    setCommentInputs(prev => ({ ...prev, [postId]: '' }))
    await saveDataToFirebase(academyData, updatedPosts, users, attendances)
  }

  // 댓글 삭제
  const handleDeleteComment = async (postId: string, comment: Comment) => {
    if (!currentUser) return
    if (currentUser.role === 'ADMIN' || currentUser.name === comment.author) {
      const updatedPosts = posts.map(p => {
        if (p.id === postId) {
          return {
            ...p,
            comments: p.comments.filter(c => c.id !== comment.id)
          }
        }
        return p
      })
      setPosts(updatedPosts)
      await saveDataToFirebase(academyData, updatedPosts, users, attendances)
    } else {
      alert('본인 댓글만 삭제 가능합니다.')
    }
  }

  // 학원 정보 수정 저장
  const handleSaveAcademyData = async () => {
    await saveDataToFirebase(editForm, posts, users, attendances)
    setAcademyData(editForm)
    alert('학원 정보가 수정되었습니다!')
  }

  // 일정을 세미콜론 기준으로 파싱하여 출력
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
          const lines = body.split('\n').map(line => line.trim()).filter(Boolean)
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

  // 게시판 미디어 파싱
  const renderPostContent = (postId: string, content: string) => {
    const tokens = content.split(/\s+/)
    const youtubeUrls: string[] = []
    const imageUrls: string[] = []

    tokens.forEach(token => {
      if (extractYouTubeId(token)) {
        youtubeUrls.push(token)
      } else if (isImageUrl(token)) {
        if (token.includes('drive.google.com')) {
          const driveId = extractGoogleDriveId(token)
          if (driveId) imageUrls.push(`https://lh3.googleusercontent.com/d/${driveId}`)
        } else {
          imageUrls.push(token)
        }
      }
    })

    const cleanContent = content
      .replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/g, '')
      .replace(/(https?:\/\/)?drive\.google\.com\/[^\s]+/g, '')
      .replace(/(https?:\/\/[^\s]+?\.(?:jpeg|jpg|gif|png|webp))/g, '')
      .trim()

    const isPlaying = playingPostId === postId

    return (
      <div className="post-parsed-content">
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
                        title="YouTube Video"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      ></iframe>
                    </div>
                  ) : (
                    <div className="youtube-thumbnail-container" onClick={() => setPlayingPostId(postId)}>
                      <img src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} alt="썸네일" className="yt-thumbnail" />
                      <button className="play-overlay-btn" type="button">▶ 영상 재생하기</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {imageUrls.length > 0 && (
          <div className="post-images-grid">
            {imageUrls.map((url, idx) => (
              <img key={idx} src={url} alt={`업로드 이미지 ${idx}`} className="post-embed-img" />
            ))}
          </div>
        )}

        {cleanContent && <p className="post-text-body">{cleanContent}</p>}
      </div>
    )
  }

  // 관리자 모드 출석 필터링
  const getFilteredAttendances = () => {
    if (filterMode === 'DAILY') {
      return attendances.filter(a => a.date === selectedDate)
    }
    if (filterMode === 'WEEKLY') {
      const targetDate = new Date(selectedDate)
      const targetWeek = getWeekNumber(targetDate)
      const targetYear = targetDate.getFullYear()
      return attendances.filter(a => {
        const d = new Date(a.date)
        return d.getFullYear() === targetYear && getWeekNumber(d) === targetWeek
      })
    }
    return attendances
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

        {/* 상단 로그인 상태 바 */}
        <div className="admin-bar">
          {currentUser ? (
            <div className="user-info-bar">
              <span>
                <strong>{currentUser.name}</strong> ({currentUser.role === 'ADMIN' ? '관리자' : '회원'})님
              </span>
              <button className="admin-btn logout" onClick={handleLogout}>로그아웃</button>
            </div>
          ) : (
            <button className="admin-btn" onClick={() => { setAuthMode('LOGIN'); setShowAuthModal(true) }}>
              🔑 로그인 / 회원가입
            </button>
          )}
        </div>
      </header>

      {/* 로그인 / 회원가입 모달 */}
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{authMode === 'LOGIN' ? '로그인' : '회원가입'}</h3>
            {authMode === 'LOGIN' ? (
              <form onSubmit={handleLogin}>
                <input
                  type="text"
                  placeholder="아이디"
                  value={loginId}
                  onChange={e => setLoginId(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={loginPw}
                  onChange={e => setLoginPw(e.target.value)}
                  required
                />
                <div className="modal-buttons">
                  <button type="submit" className="btn-confirm">로그인</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowAuthModal(false)}>취소</button>
                </div>
                <p className="auth-switch-text" onClick={() => setAuthMode('REGISTER')}>
                  계정이 없으신가요? <u>회원가입</u>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegister}>
                <input
                  type="text"
                  placeholder="아이디"
                  value={regId}
                  onChange={e => setRegId(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={regPw}
                  onChange={e => setRegPw(e.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="이름"
                  value={regName}
                  onChange={e => setRegName(e.target.value)}
                  required
                />
                <textarea
                  placeholder="아인클랑에 온 이유"
                  value={regReason}
                  onChange={e => setRegReason(e.target.value)}
                  className="modal-textarea"
                  required
                />
                <div className="modal-buttons">
                  <button type="submit" className="btn-confirm">가입 완료</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowAuthModal(false)}>취소</button>
                </div>
                <p className="auth-switch-text" onClick={() => setAuthMode('LOGIN')}>
                  이미 계정이 있으신가요? <u>로그인</u>
                </p>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 네비게이션 탭 */}
      <nav className="academy-nav">
        <button className={activeTab === 'about' ? 'active' : ''} onClick={() => setActiveTab('about')}>학원소개</button>
        <button className={activeTab === 'courses' ? 'active' : ''} onClick={() => setActiveTab('courses')}>수강과목</button>
        <button className={activeTab === 'schedule' ? 'active' : ''} onClick={() => setActiveTab('schedule')}>이달의 일정</button>
        <button className={activeTab === 'instructors' ? 'active' : ''} onClick={() => setActiveTab('instructors')}>강사진</button>
        <button className={activeTab === 'board' ? 'active' : ''} onClick={() => setActiveTab('board')}>게시판</button>

        {/* 회원용 My QR 탭 */}
        {currentUser && currentUser.role === 'USER' && (
          <button className={activeTab === 'qr' ? 'active' : ''} onClick={() => setActiveTab('qr')}>📱 내 QR코드</button>
        )}

        {/* 관리자용 출석 관리 & QR 스캐너 탭 */}
        {currentUser && currentUser.role === 'ADMIN' && (
          <>
            <button className={activeTab === 'qr' ? 'active' : ''} onClick={() => setActiveTab('qr')}>📷 QR 스캐너</button>
            <button className={activeTab === 'attendance' ? 'active' : ''} onClick={() => setActiveTab('attendance')}>📊 출석부</button>
          </>
        )}
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="academy-content">
        {/* 관리자 정보 수정 폼 */}
        {currentUser?.role === 'ADMIN' && (
          <div className="admin-editor-box">
            <h3>✏️ 관리자 수강 및 일정 정보 수정</h3>
            <label>
              <strong>이달의 일정 / 버스킹:</strong>
              <textarea rows={3} value={editForm.schedule} onChange={e => setEditForm({ ...editForm, schedule: e.target.value })} />
            </label>
            <label>
              <strong>커리큘럼 공지:</strong>
              <textarea rows={3} value={editForm.curriculum} onChange={e => setEditForm({ ...editForm, curriculum: e.target.value })} />
            </label>
            <button className="save-btn" onClick={handleSaveAcademyData}>💾 변경사항 저장하기</button>
          </div>
        )}

        {/* 1. 학원소개 */}
        {activeTab === 'about' && (
          <section className="tab-content">
            <h2>🎧 아인클랑과 함께하는 음악 퍼포먼스</h2>
            <div className="video-container">
              <iframe src="https://www.youtube.com/embed/QzKwMGicdwU" title="Performance" allowFullScreen></iframe>
            </div>
            <div className="quote-box">"음악은 말로 표현할 수 없는 것을 표현해 줍니다."</div>
          </section>
        )}

        {/* 2. 수강과목 */}
        {activeTab === 'courses' && (
          <section className="tab-content text-left">
            <h2>🎸 클래스 라인업</h2>
            <div className="course-grid">
              <div className="course-card">
                <img src={CLASS_IMG_1} alt="통기타" />
                <div className="course-info">
                  <h3>통기타 & 핑거스타일</h3>
                  <p>기초 코드 반주부터 트렌디한 핑거스타일 솔로 연주까지</p>
                </div>
              </div>
              <div className="course-card">
                <img src={CLASS_IMG_3} alt="보컬/미디" />
                <div className="course-info">
                  <h3>보컬 & 미디 / 작곡</h3>
                  <p>발성 기법부터 음원 레코딩 제작까지 원스톱 프로세스</p>
                </div>
              </div>
            </div>
            {academyData.curriculum && renderFormattedContent(academyData.curriculum)}
          </section>
        )}

        {/* 3. 이달의 일정 */}
        {activeTab === 'schedule' && (
          <section className="tab-content text-left">
            <h2>📅 이달의 레슨 & 라이브 일정</h2>
            {renderFormattedContent(academyData.schedule)}
          </section>
        )}

        {/* 4. 강사진 */}
        {activeTab === 'instructors' && (
          <section className="tab-content text-left">
            <h2>👥 프로 아티스트 강사진</h2>
            {renderFormattedContent(
              academyData.instructors || `통기타/핑거스타일/ 원장 실용음악과 아쿠스틱 기타 전공\n;보컬 트레이닝/ 보컬 수석 강사`
            )}
          </section>
        )}

        {/* 5. 게시판 */}
        {activeTab === 'board' && (
          <section className="tab-content text-left">
            <div className="board-top-header">
              <h2>📋 자유 게시판</h2>
              {currentUser ? (
                <button className="toggle-write-btn" onClick={() => setShowWriteForm(!showWriteForm)}>
                  {showWriteForm ? '❌ 작성 창 닫기' : '✍️ 새 글 작성'}
                </button>
              ) : (
                <span className="info-badge">로그인 후 글 작성이 가능합니다.</span>
              )}
            </div>

            {showWriteForm && currentUser && (
              <form className="post-create-form" onSubmit={handleCreatePost}>
                <h3>✍️ 글 작성 ({currentUser.name})</h3>
                <input
                  type="text"
                  placeholder="제목"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="input-field mb-12"
                  required
                />
                <textarea
                  rows={4}
                  placeholder="내용을 입력하세요. (유튜브 주소나 이미지 URL 포함 가능)"
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="input-field text-area"
                  required
                />
                <button type="submit" className="submit-post-btn">📌 등록하기</button>
              </form>
            )}

            {/* 게시글 리스트 */}
            <div className="posts-list">
              {posts.length === 0 ? (
                <div className="empty-posts">등록된 게시물이 없습니다.</div>
              ) : (
                posts.map(post => {
                  const currInput = commentInputs[post.id] || ''
                  const canDelete = currentUser && (currentUser.role === 'ADMIN' || currentUser.id === post.authorId)

                  return (
                    <article key={post.id} className="post-card">
                      <div className="post-header">
                        <div className="post-header-main">
                          <h3 className="post-title">{post.title}</h3>
                          <span className="post-date">{post.authorName} · {post.createdAt}</span>
                        </div>
                        {canDelete && (
                          <button className="delete-btn" onClick={() => handleDeletePost(post)}>🗑️ 삭제</button>
                        )}
                      </div>

                      {renderPostContent(post.id, post.content)}

                      {/* 댓글 목록 */}
                      <div className="comments-section">
                        <h4>💬 댓글 ({post.comments?.length || 0})</h4>

                        {currentUser && (
                          <div className="comment-form-grid">
                            <div className="comment-inputs-bottom">
                              <input
                                type="text"
                                placeholder="댓글을 입력하세요..."
                                value={currInput}
                                onChange={e => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                                onKeyDown={e => e.key === 'Enter' && handleAddComment(post.id)}
                                className="comment-text-input"
                              />
                              <button type="button" className="add-comment-btn" onClick={() => handleAddComment(post.id)}>
                                등록
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 댓글 리스트 (최신 댓글이 위로 쌓임) */}
                        <div className="comments-list">
                          {post.comments?.map(c => (
                            <div key={c.id} className="comment-item">
                              <div className="comment-main-info">
                                <div className="comment-header-row">
                                  <span className="comment-author">{c.author}</span>
                                  <span className="comment-date">{c.createdAt}</span>
                                </div>
                                <div className="comment-text">{c.text}</div>
                              </div>
                              {(currentUser?.role === 'ADMIN' || currentUser?.name === c.author) && (
                                <button className="comment-del-btn" onClick={() => handleDeleteComment(post.id, c)}>✕</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        )}

        {/* 6. 내 QR 코드 (회원 전용) */}
        {activeTab === 'qr' && currentUser?.role === 'USER' && (
          <section className="tab-content text-center">
            <h2>📱 나의 출석 QR 코드</h2>
            <div className="qr-container">
              <QRCodeSVG
                value={JSON.stringify({ studentId: currentUser.id, name: currentUser.name })}
                size={220}
                level="H"
              />
              <h3>{currentUser.name} 원생</h3>
              <p className="desc-text">학원 데스크에 설치된 스캐너에 QR 코드를 찍어주세요.</p>
            </div>
          </section>
        )}

        {/* 7. QR 스캐너 (관리자 전용) */}
        {activeTab === 'qr' && currentUser?.role === 'ADMIN' && (
          <section className="tab-content text-center">
            <h2>📷 출석 체크 QR 스캐너</h2>
            <p className="desc-text mb-12">원생의 QR 코드를 카메라에 스캔해주세요. (오늘 첫 스캔: 등원 / 두번째 스캔: 하원)</p>
            <div id="qr-reader" style={{ maxWidth: '400px', margin: '0 auto' }}></div>
          </section>
        )}

        {/* 8. 출석 기록 관리 (관리자 전용) */}
        {activeTab === 'attendance' && currentUser?.role === 'ADMIN' && (
          <section className="tab-content text-left">
            <h2>📊 출석 기록 및 통계</h2>

            {/* 필터 설정 */}
            <div className="filter-bar">
              <button className={filterMode === 'ALL' ? 'active' : ''} onClick={() => setFilterMode('ALL')}>전체 보기</button>
              <button className={filterMode === 'DAILY' ? 'active' : ''} onClick={() => setFilterMode('DAILY')}>일별 조회</button>
              <button className={filterMode === 'WEEKLY' ? 'active' : ''} onClick={() => setFilterMode('WEEKLY')}>주별 조회</button>

              {filterMode !== 'ALL' && (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="date-picker-input"
                />
              )}
            </div>

            {/* 출석 테이블 */}
            <div className="table-responsive">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>이름 (ID)</th>
                    <th>등원 시간</th>
                    <th>하원 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredAttendances().length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>출석 기록이 없습니다.</td>
                    </tr>
                  ) : (
                    getFilteredAttendances().map(a => (
                      <tr key={a.id}>
                        <td>{a.date}</td>
                        <td>{a.userName} ({a.userId})</td>
                        <td><span className="badge-in">{a.checkIn}</span></td>
                        <td>
                          {a.checkOut ? (
                            <span className="badge-out">{a.checkOut}</span>
                          ) : (
                            <span className="badge-pending">수업 중</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
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