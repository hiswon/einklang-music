import React, { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { QRCodeSVG } from 'qrcode.react'
import { Html5QrcodeScanner } from 'html5-qrcode'

const HEADER_BG = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1200&auto=format&fit=crop'
const CLASS_IMG_1 = 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?q=80&w=800&auto=format&fit=crop'
const CLASS_IMG_3 = 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?q=80&w=800&auto=format&fit=crop'

export type UserCategory = 'GENERAL' | 'KIDS' | 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'ADULT'

export const CATEGORY_LABELS: Record<UserCategory, string> = {
  GENERAL: '일반 (글쓰기 전용)',
  KIDS: '유치부',
  ELEMENTARY: '초등부',
  MIDDLE: '중등부',
  HIGH: '고등부',
  ADULT: '성인부'
}

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
  category: UserCategory
  role: 'ADMIN' | 'USER'
}

interface AttendanceRecord {
  id: string
  userId: string
  userName: string
  category: UserCategory
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
type AdminMode = 'OBSERVE' | 'EDIT' | 'QR'

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

const ADMIN_ACCOUNTS: User[] = [
  { id: 'jin', password: '12345', name: '관리자1(jin)', reason: '관리자', category: 'ADULT', role: 'ADMIN' },
  { id: 'rang', password: '67890', name: '관리자2(rang)', reason: '관리자', category: 'ADULT', role: 'ADMIN' }
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

function getWeekNumber(d: Date) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('about')
  const [adminMode, setAdminMode] = useState<AdminMode>('OBSERVE')

  const [academyData, setAcademyData] = useState<AcademyData>({
    schedule: defaultSchedule,
    curriculum: '',
    events: '',
    instructors: ''
  })
  const [posts, setPosts] = useState<Post[]>([])
  const [users, setUsers] = useState<User[]>(ADMIN_ACCOUNTS)
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])

  const [currentUser, setCurrentUser] = useState<User | null>(null)

  // 회원가입/로그인 모달
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false)
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN')
  const [loginId, setLoginId] = useState('')
  const [loginPw, setLoginPw] = useState('')

  const [regId, setRegId] = useState('')
  const [regPw, setRegPw] = useState('')
  const [regName, setRegName] = useState('')
  const [regReason, setRegReason] = useState('')
  const [regCategory, setRegCategory] = useState<UserCategory>('GENERAL')

  // 게시판
  const [showWriteForm, setShowWriteForm] = useState<boolean>(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [playingPostId, setPlayingPostId] = useState<string | null>(null)
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({})

  // 편집용
  const [editForm, setEditForm] = useState<AcademyData>(academyData)

  // 관리자 필터 및 암호 입력
  const [filterMode, setFilterMode] = useState<'ALL' | 'DAILY' | 'WEEKLY'>('ALL')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [showExitPasswordModal, setShowExitPasswordModal] = useState(false)
  const [exitPasswordInput, setExitPasswordInput] = useState('')
  const [targetAdminMode, setTargetAdminMode] = useState<AdminMode>('OBSERVE')

  // 데이터 조회
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
        users: uList.filter(u => u.role !== 'ADMIN'),
        attendances: aList
      })
    } catch (e) {
      console.error('Firebase 저장 오류:', e)
    }
  }

  // 로그인
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

  // 회원가입
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
      category: regCategory,
      role: 'USER'
    }

    const updatedUsers = [...users, newUser]
    setUsers(updatedUsers)
    setCurrentUser(newUser)
    setShowAuthModal(false)

    setRegId(''); setRegPw(''); setRegName(''); setRegReason(''); setRegCategory('GENERAL')
    await saveDataToFirebase(academyData, posts, updatedUsers, attendances)
    alert('회원가입이 완료되었습니다!')
  }

  // 로그아웃 & 탈퇴
  const handleLogout = () => {
    setCurrentUser(null)
    setActiveTab('about')
    alert('로그아웃 되었습니다.')
  }

  const handleDeleteAccount = async () => {
    if (!currentUser) return
    if (currentUser.role === 'ADMIN') {
      alert('관리자 계정은 탈퇴할 수 없습니다.')
      return
    }
    if (window.confirm('정말로 탈퇴하시겠습니까? 등록된 회원 정보가 삭제됩니다.')) {
      const updatedUsers = users.filter(u => u.id !== currentUser.id)
      setUsers(updatedUsers)
      setCurrentUser(null)
      await saveDataToFirebase(academyData, posts, updatedUsers, attendances)
      alert('회원 탈퇴가 완료되었습니다.')
    }
  }

  // QR 출석 처리 (등원 / 하원)
  const processAttendance = async (scannedUserId: string) => {
    const student = users.find(u => u.id === scannedUserId)
    if (!student) {
      alert('존재하지 않는 회원 정보입니다.')
      return
    }
    if (student.category === 'GENERAL') {
      alert('일반 회원은 QR 출석 대상이 아닙니다.')
      return
    }

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const timeStr = now.toTimeString().split(' ')[0]

    const existingIndex = attendances.findIndex(
      a => a.userId === scannedUserId && a.date === todayStr
    )

    let updatedList = [...attendances]

    if (existingIndex === -1) {
      const newRec: AttendanceRecord = {
        id: Date.now().toString(),
        userId: student.id,
        userName: student.name,
        category: student.category,
        date: todayStr,
        checkIn: timeStr,
        timestamp: now.getTime()
      }
      updatedList.unshift(newRec)
      alert(`[등원 완료] ${student.name} (${CATEGORY_LABELS[student.category]}) - 등원: ${timeStr}`)
    } else {
      const targetRec = updatedList[existingIndex]
      if (targetRec.checkOut) {
        alert(`${student.name}님은 이미 오늘 하원 처리까지 완료되었습니다.`)
        return
      }
      updatedList[existingIndex] = {
        ...targetRec,
        checkOut: timeStr
      }
      alert(`[하원 완료] ${student.name} (${CATEGORY_LABELS[student.category]}) - 하원: ${timeStr}`)
    }

    setAttendances(updatedList)
    await saveDataToFirebase(academyData, posts, users, updatedList)
  }

  // 관리자 모드 변경 제어 (QR 모드 탈출 시 암호 검증)
  const handleAdminModeChange = (mode: AdminMode) => {
    if (adminMode === 'QR' && mode !== 'QR') {
      setTargetAdminMode(mode)
      setShowExitPasswordModal(true)
    } else {
      setAdminMode(mode)
    }
  }

  const handleVerifyExitPassword = (e: React.FormEvent) => {
    e.preventDefault()
    if (exitPasswordInput === '12345') {
      setAdminMode(targetAdminMode)
      setShowExitPasswordModal(false)
      setExitPasswordInput('')
    } else {
      alert('암호가 올바르지 않습니다.')
    }
  }

  // QR 스캐너 바인딩
  useEffect(() => {
    if ((activeTab === 'qr' || adminMode === 'QR') && currentUser?.role === 'ADMIN') {
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
  }, [activeTab, adminMode, currentUser])

  // 게시판 좋아요 및 작성/댓글
  const handleToggleLike = async (postId: string) => {
    const updated = posts.map(p => {
      if (p.id === postId) {
        return { ...p, likes: (p.likes || 0) + 1 }
      }
      return p
    })
    setPosts(updated)
    await saveDataToFirebase(academyData, updated, users, attendances)
  }

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
          comments: [newComment, ...(p.comments || [])]
        }
      }
      return p
    })

    setPosts(updatedPosts)
    setCommentInputs(prev => ({ ...prev, [postId]: '' }))
    await saveDataToFirebase(academyData, updatedPosts, users, attendances)
  }

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
    }
  }

  const handleSaveAcademyData = async () => {
    await saveDataToFirebase(editForm, posts, users, attendances)
    setAcademyData(editForm)
    alert('학원 정보가 수정되었습니다!')
  }

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

  // 관리자 전용 : 큐알 전용 모드 화면
  if (currentUser?.role === 'ADMIN' && adminMode === 'QR') {
    return (
      <div className="full-qr-mode-screen">
        <div className="qr-mode-header">
          <h2>📷 아인클랑 QR 출석 전용 스캐너</h2>
          <button className="exit-qr-mode-btn" onClick={() => handleAdminModeChange('OBSERVE')}>
            🔒 스캐너 모드 종료 (암호 필요)
          </button>
        </div>
        <div id="qr-reader" style={{ maxWidth: '500px', width: '100%', margin: '0 auto' }}></div>

        {showExitPasswordModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>🔒 모드 전환 암호 입력</h3>
              <p className="desc-text">학생들의 오작동을 방지하기 위해 암호를 입력해야 합니다. (기본: 12345)</p>
              <form onSubmit={handleVerifyExitPassword}>
                <input
                  type="password"
                  placeholder="관리자 암호"
                  value={exitPasswordInput}
                  onChange={e => setExitPasswordInput(e.target.value)}
                  required
                />
                <div className="modal-buttons">
                  <button type="submit" className="btn-confirm">확인</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowExitPasswordModal(false)}>취소</button>
                </div>
              </form>
            </div>
          </div>
        )}
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

        {/* 상단 로그인 바 */}
        <div className="admin-bar">
          {currentUser ? (
            <div className="user-info-bar">
              <span>
                <strong>{currentUser.name}</strong> [{CATEGORY_LABELS[currentUser.category]}]
              </span>
              {currentUser.role === 'ADMIN' && (
                <div className="admin-mode-selector">
                  <button className={adminMode === 'OBSERVE' ? 'active' : ''} onClick={() => handleAdminModeChange('OBSERVE')}>👀 관찰모드</button>
                  <button className={adminMode === 'EDIT' ? 'active' : ''} onClick={() => handleAdminModeChange('EDIT')}>✏️ 수정모드</button>
                  <button className={adminMode === 'QR' ? 'active' : ''} onClick={() => handleAdminModeChange('QR')}>📷 QR모드</button>
                </div>
              )}
              {currentUser.role === 'USER' && (
                <button className="admin-btn delete-acc" onClick={handleDeleteAccount}>회원 탈퇴</button>
              )}
              <button className="admin-btn logout" onClick={handleLogout}>로그아웃</button>
            </div>
          ) : (
            <button className="admin-btn" onClick={() => { setAuthMode('LOGIN'); setShowAuthModal(true) }}>
              🔑 로그인 / 회원가입
            </button>
          )}
        </div>
      </header>

      {/* 로그인/회원가입 모달 */}
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
                <label className="input-label">회원 구분 선택:</label>
                <select
                  value={regCategory}
                  onChange={e => setRegCategory(e.target.value as UserCategory)}
                  className="modal-select"
                >
                  <option value="GENERAL">일반 (글쓰기 전용, QR코드 미발급)</option>
                  <option value="KIDS">유치부</option>
                  <option value="ELEMENTARY">초등부</option>
                  <option value="MIDDLE">중등부</option>
                  <option value="HIGH">고등부</option>
                  <option value="ADULT">성인부</option>
                </select>

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

      {/* 네비게이션 */}
      <nav className="academy-nav">
        <button className={activeTab === 'about' ? 'active' : ''} onClick={() => setActiveTab('about')}>학원소개</button>
        <button className={activeTab === 'courses' ? 'active' : ''} onClick={() => setActiveTab('courses')}>수강과목</button>
        <button className={activeTab === 'schedule' ? 'active' : ''} onClick={() => setActiveTab('schedule')}>이달의 일정</button>
        <button className={activeTab === 'instructors' ? 'active' : ''} onClick={() => setActiveTab('instructors')}>강사진</button>
        <button className={activeTab === 'board' ? 'active' : ''} onClick={() => setActiveTab('board')}>게시판</button>

        {currentUser && currentUser.role === 'USER' && (
          <button className={activeTab === 'qr' ? 'active' : ''} onClick={() => setActiveTab('qr')}>📱 마이 QR/출석현황</button>
        )}

        {currentUser && currentUser.role === 'ADMIN' && (
          <button className={activeTab === 'attendance' ? 'active' : ''} onClick={() => setActiveTab('attendance')}>📊 원생 출석부</button>
        )}
      </nav>

      <main className="academy-content">
        {/* 수정 모드일 때만 정보 수정 창 표시 */}
        {currentUser?.role === 'ADMIN' && adminMode === 'EDIT' && (
          <div className="admin-editor-box">
            <h3>✏️ 학원 수강 및 일정 수정 (수정 모드)</h3>
            <label>
              <strong>이달의 일정:</strong>
              <textarea rows={3} value={editForm.schedule} onChange={e => setEditForm({ ...editForm, schedule: e.target.value })} />
            </label>
            <label>
              <strong>커리큘럼:</strong>
              <textarea rows={3} value={editForm.curriculum} onChange={e => setEditForm({ ...editForm, curriculum: e.target.value })} />
            </label>
            <button className="save-btn" onClick={handleSaveAcademyData}>💾 저장하기</button>
          </div>
        )}

        {/* 1. 학원소개 */}
        {activeTab === 'about' && (
          <section className="tab-content">
            <h2>🎧 아인클랑 퍼포먼스</h2>
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

        {/* 5. 자유 게시판 */}
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
                  placeholder="내용을 입력하세요. (유튜브 주소나 이미지 URL 지원)"
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="input-field text-area"
                  required
                />
                <button type="submit" className="submit-post-btn">📌 등록하기</button>
              </form>
            )}

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

                      {/* 좋아요 버튼 추가 */}
                      <div className="post-actions">
                        <button className="like-btn" onClick={() => handleToggleLike(post.id)}>
                          ❤️ 좋아요 {post.likes > 0 && `(${post.likes})`}
                        </button>
                      </div>

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

        {/* 6. 마이 QR 코드 및 본인 등/하원 시간 확인 (원생 전용) */}
        {activeTab === 'qr' && currentUser?.role === 'USER' && (
          <section className="tab-content text-center">
            <h2>📱 마이 QR & 출석 정보</h2>
            {currentUser.category === 'GENERAL' ? (
              <div className="info-box-general">
                <h3>일반 회원 (글쓰기 전용 계정)</h3>
                <p>일반 회원은 학원 등/하원 QR 코드가 발급되지 않습니다.</p>
              </div>
            ) : (
              <>
                <div className="qr-container">
                  <QRCodeSVG
                    value={JSON.stringify({ studentId: currentUser.id, name: currentUser.name })}
                    size={220}
                    level="H"
                  />
                  <h3>{currentUser.name} ({CATEGORY_LABELS[currentUser.category]})</h3>
                  <p className="desc-text">데스크에 설치된 스캐너에 QR 코드를 찍어주세요.</p>
                </div>

                {/* 본인의 출석 및 등/하원 기록 */}
                <div className="my-attendance-history">
                  <h3>📜 나의 등 / 하원 기록</h3>
                  <div className="table-responsive">
                    <table className="attendance-table">
                      <thead>
                        <tr>
                          <th>날짜</th>
                          <th>등원 시간</th>
                          <th>하원 시간</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendances.filter(a => a.userId === currentUser.id).length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ textAlign: 'center', padding: '16px' }}>출석 기록이 없습니다.</td>
                          </tr>
                        ) : (
                          attendances
                            .filter(a => a.userId === currentUser.id)
                            .map(a => (
                              <tr key={a.id}>
                                <td>{a.date}</td>
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
                </div>
              </>
            )}
          </section>
        )}

        {/* 7. 관리자 출석부 및 전체 통계 */}
        {activeTab === 'attendance' && currentUser?.role === 'ADMIN' && (
          <section className="tab-content text-left">
            <h2>📊 부문별 등록 인원 현황</h2>

            {/* 그룹별 전체 회원 수 통계 카운팅 */}
            <div className="category-stats-grid">
              {(['KIDS', 'ELEMENTARY', 'MIDDLE', 'HIGH', 'ADULT', 'GENERAL'] as UserCategory[]).map(cat => {
                const count = users.filter(u => u.category === cat && u.role !== 'ADMIN').length
                return (
                  <div key={cat} className="stat-card">
                    <span className="stat-label">{CATEGORY_LABELS[cat]}</span>
                    <span className="stat-count">{count} 명</span>
                  </div>
                )
              })}
            </div>

            <h2 style={{ marginTop: '24px' }}>📋 원생 출석/등하원 기록</h2>

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

            <div className="table-responsive">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>구분</th>
                    <th>이름 (ID)</th>
                    <th>등원 시간</th>
                    <th>하원 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredAttendances().length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>출석 기록이 없습니다.</td>
                    </tr>
                  ) : (
                    getFilteredAttendances().map(a => (
                      <tr key={a.id}>
                        <td>{a.date}</td>
                        <td><span className="cat-badge">{CATEGORY_LABELS[a.category]}</span></td>
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