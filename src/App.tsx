import React, { useState, useEffect, useMemo } from 'react'
import './App.css'
import { db } from './firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { QRCodeSVG } from 'qrcode.react'
import { Html5QrcodeScanner } from 'html5-qrcode'

const HEADER_BG = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1200&auto=format&fit=crop'
const CLASS_IMG_1 = 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?q=80&w=800&auto=format&fit=crop'
const CLASS_IMG_3 = 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?q=80&w=800&auto=format&fit=crop'
const ACADEMY_URL = 'https://einklang-music.vercel.app/'

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
  userCategory: UserCategory
  date: string // YYYY-MM-DD
  checkIn: string // HH:mm
  checkOut?: string // HH:mm
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
  likedUsers: string[]
  comments: Comment[]
}

type TabType = 'about' | 'courses' | 'schedule' | 'instructors' | 'board' | 'attendance' | 'qr'
type AdminMode = 'VIEW' | 'EDIT' | 'QR'

const defaultSchedule = `3월 15일/ 버스킹 정기 라이브
신정호 야외무대 오후 5시
참여 학생 리허설 오후 3시
;
3월 22일/ 1:1 맞춤 무료 청강 데이
보컬 & 통기타 파트 선착순 모집
;
4월 05일/ 봄맞이 레코딩 세션`

const ADMIN_ACCOUNTS: User[] = [
  { id: 'jin', password: '12345', name: '관리자1(jin)', reason: '관리자 계정', category: 'GENERAL', role: 'ADMIN' },
  { id: 'rang', password: '67890', name: '관리자2(rang)', reason: '관리자 계정', category: 'GENERAL', role: 'ADMIN' }
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

function getFormattedTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

// 분기 추출 유틸 (1: Q1, 2: Q2, 3: Q3, 4: Q4)
function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('about')

  // 기본 상태
  const [academyData, setAcademyData] = useState<AcademyData>({
    schedule: defaultSchedule,
    curriculum: '',
    events: '',
    instructors: ''
  })
  const [posts, setPosts] = useState<Post[]>([])
  const [users, setUsers] = useState<User[]>(ADMIN_ACCOUNTS)
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])

  // 인증 및 로그인 사용자
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false)
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER' | 'DELETE_ACCOUNT'>('LOGIN')

  // 폼 입력값
  const [loginId, setLoginId] = useState('')
  const [loginPw, setLoginPw] = useState('')
  const [regId, setRegId] = useState('')
  const [regPw, setRegPw] = useState('')
  const [regName, setRegName] = useState('')
  const [regReason, setRegReason] = useState('')
  const [regCategory, setRegCategory] = useState<UserCategory>('GENERAL')
  const [delId, setDelId] = useState('')
  const [delPw, setDelPw] = useState('')

  // 게시글
  const [showWriteForm, setShowWriteForm] = useState<boolean>(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [playingPostId, setPlayingPostId] = useState<string | null>(null)
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({})

  // 관리자 제어
  const [editForm, setEditForm] = useState<AcademyData>(academyData)
  const [adminMode, setAdminMode] = useState<AdminMode>('VIEW')
  const [qrPassModal, setQrPassModal] = useState<boolean>(false)
  const [qrInputPass, setQrInputPass] = useState('')
  const [targetAdminMode, setTargetAdminMode] = useState<AdminMode>('VIEW')

  // 관리자 출석 필터 및 현황
  const [filterMode, setFilterMode] = useState<'ALL' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'>('ALL')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [searchStudentQuery, setSearchStudentQuery] = useState('')

  // QR 스캔 안내 메시지
  const [scanMessage, setScanMessage] = useState<string>('')
  const [scanMessageType, setScanMessageType] = useState<'in' | 'out' | 'error' | ''>('')

  // Firebase 데이터 로드
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
            const merged = [...ADMIN_ACCOUNTS]
            fetched.users.forEach((u: User) => {
              if (!merged.find(exist => exist.id === u.id)) merged.push(u)
            })
            setUsers(merged)
          }
          if (fetched.attendances) setAttendances(fetched.attendances)
        }
      } catch (e) {
        console.error('Firebase 로딩 실패:', e)
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
      console.error('Firebase 저장 실패:', e)
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
      if (target.role === 'ADMIN') setAdminMode('VIEW')
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

    setRegId(''); setRegPw(''); setRegName(''); setRegReason('')
    await saveDataToFirebase(academyData, posts, updatedUsers, attendances)
    alert('회원가입이 완료되었습니다!')
  }

  // 탈퇴 처리 (유저 본인)
  const handleSelfDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = users.find(u => u.id === delId && u.password === delPw)

    if (!target) {
      alert('아이디 또는 비밀번호가 일치하지 않습니다.')
      return
    }
    if (target.role === 'ADMIN') {
      alert('관리자 계정은 탈퇴할 수 없습니다.')
      return
    }

    if (window.confirm(`정말로 탈퇴하시겠습니까? (${target.name}님의 모든 출석 기록이 삭제됩니다.)`)) {
      await deleteUserAndAttendance(target.id)
      setShowAuthModal(false)
      setDelId(''); setDelPw('')
      if (currentUser?.id === target.id) setCurrentUser(null)
      alert('회원 탈퇴 및 출석 기록 삭제가 완료되었습니다.')
    }
  }

  // 회원 및 출석 기록 일괄 삭제 유틸
  const deleteUserAndAttendance = async (userId: string) => {
    const updatedUsers = users.filter(u => u.id !== userId)
    const updatedAttendances = attendances.filter(a => a.userId !== userId)

    setUsers(updatedUsers)
    setAttendances(updatedAttendances)
    await saveDataToFirebase(academyData, posts, updatedUsers, updatedAttendances)
  }

  // 관리자 모드 변경 제어 (QR 모드 이탈시 암호 체크)
  const handleAdminModeChange = (newMode: AdminMode) => {
    if (adminMode === 'QR' && newMode !== 'QR') {
      setTargetAdminMode(newMode)
      setQrPassModal(true)
    } else {
      setAdminMode(newMode)
      if (newMode === 'QR') setActiveTab('qr')
    }
  }

  const verifyQrExitPassword = () => {
    if (currentUser && currentUser.password === qrInputPass) {
      setAdminMode(targetAdminMode)
      setQrPassModal(false)
      setQrInputPass('')
    } else {
      alert('비밀번호가 올바르지 않습니다.')
    }
  }

  // QR 스캔 시 등하원 처리
  const processAttendance = async (scannedUserId: string) => {
    const student = users.find(u => u.id === scannedUserId)
    if (!student) {
      setScanMessage('⚠️ 등록되지 않은 회원 QR코드입니다.')
      setScanMessageType('error')
      return
    }

    if (student.category === 'GENERAL') {
      setScanMessage('⚠️ 일반 회원은 출석 QR 코드를 사용할 수 없습니다.')
      setScanMessageType('error')
      return
    }

    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const timeStr = getFormattedTime(now)

    const existingIndex = attendances.findIndex(
      a => a.userId === scannedUserId && a.date === todayStr
    )

    let updatedList = [...attendances]

    if (existingIndex === -1) {
      const newRec: AttendanceRecord = {
        id: Date.now().toString(),
        userId: student.id,
        userName: student.name,
        userCategory: student.category,
        date: todayStr,
        checkIn: timeStr,
        timestamp: now.getTime()
      }
      updatedList.unshift(newRec)
      setScanMessage(`[${student.name}] 환영합니다. 사랑합니다. (${timeStr})`)
      setScanMessageType('in')
    } else {
      const targetRec = updatedList[existingIndex]
      if (targetRec.checkOut) {
        setScanMessage(`[${student.name}] 오늘 등/하원이 이미 완료되었습니다.`)
        setScanMessageType('error')
        return
      }
      updatedList[existingIndex] = { ...targetRec, checkOut: timeStr }
      setScanMessage(`[${student.name}] 사랑합니다. 안녕히 가세요. (${timeStr})`)
      setScanMessageType('out')
    }

    setAttendances(updatedList)
    await saveDataToFirebase(academyData, posts, users, updatedList)
  }

  // QR 스캐너 바인딩
  useEffect(() => {
    if (activeTab === 'qr' && currentUser?.role === 'ADMIN' && adminMode === 'QR') {
      const scanner = new Html5QrcodeScanner(
        'qr-reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      )

      scanner.render(
        (decodedText) => {
          try {
            const data = JSON.parse(decodedText)
            if (data.studentId) processAttendance(data.studentId)
          } catch (e) {
            setScanMessage('⚠️ 유효한 QR 코드가 아닙니다.')
            setScanMessageType('error')
          }
        },
        () => {}
      )

      return () => {
        scanner.clear().catch(() => {})
      }
    }
  }, [activeTab, currentUser, adminMode])

  // 게시판 좋아요
  const handleLikePost = async (postId: string) => {
    if (!currentUser) {
      alert('로그인이 필요합니다.')
      return
    }

    const updatedPosts = posts.map(p => {
      if (p.id === postId) {
        const alreadyLiked = p.likedUsers?.includes(currentUser.id)
        if (alreadyLiked) {
          alert('이미 좋아요를 누르셨습니다.')
          return p
        }
        return {
          ...p,
          likes: (p.likes || 0) + 1,
          likedUsers: [...(p.likedUsers || []), currentUser.id]
        }
      }
      return p
    })

    setPosts(updatedPosts)
    await saveDataToFirebase(academyData, updatedPosts, users, attendances)
  }

  // 댓글 등록
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
        return { ...p, comments: [newComment, ...(p.comments || [])] }
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
          return { ...p, comments: p.comments.filter(c => c.id !== comment.id) }
        }
        return p
      })
      setPosts(updatedPosts)
      await saveDataToFirebase(academyData, updatedPosts, users, attendances)
    }
  }

  // 글 삭제
  const handleDeletePost = async (post: Post) => {
    if (!currentUser) return
    if (currentUser.role === 'ADMIN' || currentUser.id === post.authorId) {
      if (window.confirm('정말 삭제하시겠습니까?')) {
        const updated = posts.filter(p => p.id !== post.id)
        setPosts(updated)
        await saveDataToFirebase(academyData, updated, users, attendances)
      }
    }
  }

  // 새 게시글 저장
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return
    if (!newTitle.trim() || !newContent.trim()) {
      alert('제목과 내용을 입력하세요.')
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
      likedUsers: [],
      comments: []
    }

    const updatedPosts = [newPost, ...posts]
    setPosts(updatedPosts)
    setNewTitle(''); setNewContent('')
    setShowWriteForm(false)
    await saveDataToFirebase(academyData, updatedPosts, users, attendances)
  }

  // 출석 데이터 필터링 (일, 주, 월, 분기, 연도 조건 반영)
  const getFilteredAttendances = () => {
    let list = [...attendances]

    if (selectedCategory !== 'ALL') {
      list = list.filter(a => a.userCategory === selectedCategory)
    }

    if (searchStudentQuery.trim()) {
      const query = searchStudentQuery.toLowerCase().trim()
      list = list.filter(a => a.userName.toLowerCase().includes(query) || a.userId.toLowerCase().includes(query))
    }

    const refDate = new Date(selectedDate)
    const refYear = refDate.getFullYear()
    const refMonth = refDate.getMonth()
    const refQuarter = getQuarter(refDate)
    const refWeek = getWeekNumber(refDate)

    if (filterMode === 'DAILY') {
      list = list.filter(a => a.date === selectedDate)
    } else if (filterMode === 'WEEKLY') {
      list = list.filter(a => {
        const d = new Date(a.date)
        return d.getFullYear() === refYear && getWeekNumber(d) === refWeek
      })
    } else if (filterMode === 'MONTHLY') {
      list = list.filter(a => {
        const d = new Date(a.date)
        return d.getFullYear() === refYear && d.getMonth() === refMonth
      })
    } else if (filterMode === 'QUARTERLY') {
      list = list.filter(a => {
        const d = new Date(a.date)
        return d.getFullYear() === refYear && getQuarter(d) === refQuarter
      })
    } else if (filterMode === 'YEARLY') {
      list = list.filter(a => {
        const d = new Date(a.date)
        return d.getFullYear() === refYear
      })
    }

    return list
  }

  // 학원 관리를 위한 출석 통계 계산 (주, 월, 분기, 연간, 등원 시간대 및 그래프용 데이터)
  const attendanceAnalytics = useMemo(() => {
    const now = new Date(selectedDate)
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth()
    const currentQuarter = getQuarter(now)

    // 원생별 누적 출석일 계산 (중복 날짜 제거)
    const studentStats: Record<string, {
      userId: string
      userName: string
      category: UserCategory
      monthlyDays: Set<string>
      quarterlyDays: Set<string>
      yearlyDays: Set<string>
      totalDays: Set<string>
      checkInTimes: string[]
    }> = {}

    // 초기화
    users.filter(u => u.role !== 'ADMIN').forEach(u => {
      studentStats[u.id] = {
        userId: u.id,
        userName: u.name,
        category: u.category,
        monthlyDays: new Set(),
        quarterlyDays: new Set(),
        yearlyDays: new Set(),
        totalDays: new Set(),
        checkInTimes: []
      }
    })

    // 등원 시간대 분포 (오전: ~12시, 오후: 12~17시, 저녁: 17시~)
    let morningCount = 0
    let afternoonCount = 0
    let eveningCount = 0

    // 요일별 출석 수 (월~일)
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0] // 0:일, 1:월, ... 6:토

    // 최근 7일 일별 출석자수
    const recent7DaysMap: Record<string, Set<string>> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dStr = d.toISOString().split('T')[0]
      recent7DaysMap[dStr] = new Set()
    }

    attendances.forEach(a => {
      const aDate = new Date(a.date)
      const year = aDate.getFullYear()
      const month = aDate.getMonth()
      const quarter = getQuarter(aDate)

      if (!studentStats[a.userId]) {
        studentStats[a.userId] = {
          userId: a.userId,
          userName: a.userName,
          category: a.userCategory,
          monthlyDays: new Set(),
          quarterlyDays: new Set(),
          yearlyDays: new Set(),
          totalDays: new Set(),
          checkInTimes: []
        }
      }

      const st = studentStats[a.userId]
      st.totalDays.add(a.date)

      if (year === currentYear) {
        st.yearlyDays.add(a.date)
        if (quarter === currentQuarter) {
          st.quarterlyDays.add(a.date)
        }
        if (month === currentMonth) {
          st.monthlyDays.add(a.date)
        }
      }

      if (a.checkIn) {
        st.checkInTimes.push(a.checkIn)
        const hour = parseInt(a.checkIn.split(':')[0], 10)
        if (hour < 12) morningCount++
        else if (hour < 17) afternoonCount++
        else eveningCount++
      }

      // 요일 집계
      const dayIdx = aDate.getDay()
      dayOfWeekCounts[dayIdx]++

      // 최근 7일 집계
      if (recent7DaysMap[a.date]) {
        recent7DaysMap[a.date].add(a.userId)
      }
    })

    const totalCheckIns = attendances.length || 1
    const morningRatio = Math.round((morningCount / totalCheckIns) * 100)
    const afternoonRatio = Math.round((afternoonCount / totalCheckIns) * 100)
    const eveningRatio = Math.round((eveningCount / totalCheckIns) * 100)

    const maxDayCount = Math.max(...dayOfWeekCounts, 1)

    return {
      studentStats: Object.values(studentStats),
      timeDistribution: { morningCount, afternoonCount, eveningCount, morningRatio, afternoonRatio, eveningRatio },
      dayOfWeekCounts,
      maxDayCount,
      recent7DaysMap
    }
  }, [attendances, users, selectedDate])

  // 포맷 텍스트 렌더링
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

  // 미디어 내장 게시글 렌더링
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

  // QR 전용 모드 화면
  if (currentUser?.role === 'ADMIN' && adminMode === 'QR') {
    return (
      <div className="qr-only-wrapper">
        <div className="qr-only-header">
          <h2>🎵 아인클랑 출석 체크 전용 화면</h2>
          <button className="exit-qr-btn" onClick={() => handleAdminModeChange('VIEW')}>🔓 모드 변경 (비밀번호 입력)</button>
        </div>

        <div className="qr-only-body">
          <div id="qr-reader" style={{ width: '100%', maxWidth: '500px' }}></div>
          {scanMessage && (
            <div className={`scan-result-banner ${scanMessageType}`}>
              {scanMessage}
            </div>
          )}
        </div>

        {qrPassModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>🔒 모드 전환 암호 확인</h3>
              <p>관리자 비밀번호를 입력해주세요.</p>
              <input
                type="password"
                placeholder="비밀번호"
                value={qrInputPass}
                onChange={e => setQrInputPass(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && verifyQrExitPassword()}
              />
              <div className="modal-buttons">
                <button onClick={verifyQrExitPassword} className="btn-confirm">확인</button>
                <button onClick={() => setQrPassModal(false)} className="btn-cancel">취소</button>
              </div>
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

        {/* 상단 로그인/관리자 상태바 */}
        <div className="admin-bar">
          {currentUser ? (
            <div className="user-info-bar">
              <span>
                <strong>{currentUser.name}</strong> ({currentUser.role === 'ADMIN' ? '관리자' : CATEGORY_LABELS[currentUser.category]})님
              </span>

              {currentUser.role === 'ADMIN' && (
                <div className="admin-mode-selector">
                  <span className="label">모드:</span>
                  <button className={adminMode === 'VIEW' ? 'active' : ''} onClick={() => handleAdminModeChange('VIEW')}>관찰모드</button>
                  <button className={adminMode === 'EDIT' ? 'active' : ''} onClick={() => handleAdminModeChange('EDIT')}>수정모드</button>
                  <button className={adminMode === 'QR' ? 'active' : ''} onClick={() => handleAdminModeChange('QR')}>QR모드</button>
                </div>
              )}

              <button className="admin-btn logout" onClick={() => setCurrentUser(null)}>로그아웃</button>
            </div>
          ) : (
            <button className="admin-btn" onClick={() => { setAuthMode('LOGIN'); setShowAuthModal(true) }}>
              🔑 로그인 / 회원가입 / 탈퇴
            </button>
          )}
        </div>
      </header>

      {/* Auth 통합 모달 */}
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>
              {authMode === 'LOGIN' && '로그인'}
              {authMode === 'REGISTER' && '회원가입'}
              {authMode === 'DELETE_ACCOUNT' && '회원 탈퇴'}
            </h3>

            {authMode === 'LOGIN' && (
              <form onSubmit={handleLogin}>
                <input type="text" placeholder="아이디" value={loginId} onChange={e => setLoginId(e.target.value)} required />
                <input type="password" placeholder="비밀번호" value={loginPw} onChange={e => setLoginPw(e.target.value)} required />
                <div className="modal-buttons">
                  <button type="submit" className="btn-confirm">로그인</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowAuthModal(false)}>취소</button>
                </div>
                <div className="auth-switch-links">
                  <span onClick={() => setAuthMode('REGISTER')}>회원가입</span>
                  <span className="divider">|</span>
                  <span onClick={() => setAuthMode('DELETE_ACCOUNT')} className="danger-link">회원 탈퇴</span>
                </div>
              </form>
            )}

            {authMode === 'REGISTER' && (
              <form onSubmit={handleRegister}>
                <input type="text" placeholder="아이디" value={regId} onChange={e => setRegId(e.target.value)} required />
                <input type="password" placeholder="비밀번호" value={regPw} onChange={e => setRegPw(e.target.value)} required />
                <input type="text" placeholder="이름" value={regName} onChange={e => setRegName(e.target.value)} required />

                <label className="select-label">
                  <span>대상 분류:</span>
                  <select value={regCategory} onChange={e => setRegCategory(e.target.value as UserCategory)}>
                    <option value="GENERAL">일반 (학원 미출석/글쓰기 전용)</option>
                    <option value="KIDS">유치부</option>
                    <option value="ELEMENTARY">초등부</option>
                    <option value="MIDDLE">중등부</option>
                    <option value="HIGH">고등부</option>
                    <option value="ADULT">성인부</option>
                  </select>
                </label>

                <textarea placeholder="당신은 무엇을 좋아하나요?(사람,물건,음식..등.)" value={regReason} onChange={e => setRegReason(e.target.value)} className="modal-textarea" required />
                <div className="modal-buttons">
                  <button type="submit" className="btn-confirm">가입 완료</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowAuthModal(false)}>취소</button>
                </div>
                <div className="auth-switch-links">
                  <span onClick={() => setAuthMode('LOGIN')}>로그인으로 이동</span>
                </div>
              </form>
            )}

            {authMode === 'DELETE_ACCOUNT' && (
              <form onSubmit={handleSelfDelete}>
                <p className="warn-text">⚠️ 비밀번호를 잊으신 경우 관리자에게 요청해주세요.</p>
                <input type="text" placeholder="탈퇴할 아이디" value={delId} onChange={e => setDelId(e.target.value)} required />
                <input type="password" placeholder="비밀번호" value={delPw} onChange={e => setDelPw(e.target.value)} required />
                <div className="modal-buttons">
                  <button type="submit" className="btn-danger">탈퇴하기</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowAuthModal(false)}>취소</button>
                </div>
                <div className="auth-switch-links">
                  <span onClick={() => setAuthMode('LOGIN')}>로그인으로 이동</span>
                </div>
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

        {currentUser && currentUser.role === 'USER' && currentUser.category !== 'GENERAL' && (
          <button className={activeTab === 'qr' ? 'active' : ''} onClick={() => setActiveTab('qr')}>📱 내 QR코드 & 출석</button>
        )}

        {currentUser && currentUser.role === 'ADMIN' && (
          <>
            {adminMode === 'EDIT' && (
              <button className={activeTab === 'qr' ? 'active' : ''} onClick={() => setActiveTab('qr')}>📷 QR 스캐너</button>
            )}
            <button className={activeTab === 'attendance' ? 'active' : ''} onClick={() => setActiveTab('attendance')}>📊 출석 및 회원 관리</button>
          </>
        )}
      </nav>

      {/* Main Content */}
      <main className="academy-content">
        {currentUser?.role === 'ADMIN' && adminMode === 'EDIT' && (
          <div className="admin-editor-box">
            <h3>✏️ [수정 모드] 학원 콘텐츠 관리</h3>
            <label>
              <strong>이달의 일정 / 버스킹:</strong>
              <textarea rows={3} value={editForm.schedule} onChange={e => setEditForm({ ...editForm, schedule: e.target.value })} />
            </label>
            <label>
              <strong>커리큘럼 공지:</strong>
              <textarea rows={3} value={editForm.curriculum} onChange={e => setEditForm({ ...editForm, curriculum: e.target.value })} />
            </label>
            <button className="save-btn" onClick={async () => {
              await saveDataToFirebase(editForm, posts, users, attendances)
              setAcademyData(editForm)
              alert('수정사항이 저장되었습니다!')
            }}>💾 변경사항 저장하기</button>
          </div>
        )}

        {/* 1. 학원 소개 */}
        {activeTab === 'about' && (
          <section className="tab-content">
            <h2>🎧 아인클랑과 함께하는 음악 퍼포먼스</h2>
            <div className="video-container">
              <iframe src="https://www.youtube.com/embed/QzKwMGicdwU" title="Performance" allowFullScreen></iframe>
            </div>

            <div className="site-qr-box">
              <h3>📱 아인클랑 스마트폰 연결 QR</h3>
              <p>카메라로 아래 QR을 스캔하면 바로 모바일 웹사이트로 연결됩니다.</p>
              <QRCodeSVG value={ACADEMY_URL} size={160} level="H" className="site-qr-img" />
              <a href={ACADEMY_URL} target="_blank" rel="noreferrer" className="site-url-link">{ACADEMY_URL}</a>
            </div>
          </section>
        )}

        {/* 2. 수강 과목 */}
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
                <input type="text" placeholder="제목" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="input-field mb-12" required />
                <textarea rows={4} placeholder="내용을 입력하세요. (유튜브 주소나 이미지 URL 포함 가능)" value={newContent} onChange={e => setNewContent(e.target.value)} className="input-field text-area" required />
                <button type="submit" className="submit-post-btn">📌 등록하기</button>
              </form>
            )}

            <div className="posts-list">
              {posts.map(post => {
                const currInput = commentInputs[post.id] || ''
                const canDelete = currentUser && (currentUser.role === 'ADMIN' || currentUser.id === post.authorId)
                const isLiked = currentUser && post.likedUsers?.includes(currentUser.id)

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

                    <div className="post-actions">
                      <button
                        className={`like-btn ${isLiked ? 'liked' : ''}`}
                        onClick={() => handleLikePost(post.id)}
                      >
                        ❤️ 좋아요 {post.likes || 0}
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
                            <button type="button" className="add-comment-btn" onClick={() => handleAddComment(post.id)}>등록</button>
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
              })}
            </div>
          </section>
        )}

        {/* 6. 개인 QR코드 및 내 출석 통계 (학생) */}
        {activeTab === 'qr' && currentUser?.role === 'USER' && currentUser.category !== 'GENERAL' && (
          <section className="tab-content text-center">
            <h2>📱 나의 출석 QR 코드 및 출석 통계</h2>
            <div className="qr-container">
              <QRCodeSVG
                value={JSON.stringify({ studentId: currentUser.id, name: currentUser.name })}
                size={200}
                level="H"
              />
              <h3>{currentUser.name} 원생 ({CATEGORY_LABELS[currentUser.category]})</h3>
            </div>

            {/* 개별 학생 출석 통계 카운트 */}
            {(() => {
              const myStats = attendanceAnalytics.studentStats.find(s => s.userId === currentUser.id)
              return (
                <div className="my-stats-summary-grid">
                  <div className="stat-card">
                    <span className="stat-label">이달(월별) 출석일</span>
                    <span className="stat-value">{myStats?.monthlyDays.size || 0}일</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">분기별 출석일</span>
                    <span className="stat-value">{myStats?.quarterlyDays.size || 0}일</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">올해(연간) 출석일</span>
                    <span className="stat-value">{myStats?.yearlyDays.size || 0}일</span>
                  </div>
                </div>
              )
            })()}

            <div className="my-attendance-box">
              <h3>📅 내 최근 출석 및 등원 시간 상세</h3>
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>주차</th>
                    <th>등원 시간</th>
                    <th>하원 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {attendances.filter(a => a.userId === currentUser.id).length === 0 ? (
                    <tr><td colSpan={4}>출석 기록이 없습니다.</td></tr>
                  ) : (
                    attendances.filter(a => a.userId === currentUser.id).map(a => {
                      const d = new Date(a.date)
                      return (
                        <tr key={a.id}>
                          <td>{a.date}</td>
                          <td>{getWeekNumber(d)}주차</td>
                          <td><span className="badge-in">{a.checkIn}</span></td>
                          <td>{a.checkOut ? <span className="badge-out">{a.checkOut}</span> : <span className="badge-pending">수업 중</span>}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 7. 관리자 전용 QR 스캐너 */}
        {activeTab === 'qr' && currentUser?.role === 'ADMIN' && adminMode === 'EDIT' && (
          <section className="tab-content text-center">
            <h2>📷 출석 체크 QR 스캐너</h2>
            <div id="qr-reader" style={{ maxWidth: '400px', margin: '0 auto' }}></div>
            {scanMessage && (
              <div className={`scan-result-banner ${scanMessageType}`}>
                {scanMessage}
              </div>
            )}
          </section>
        )}

        {/* 8. 출석 및 회원 관리 + 종합 대시보드 그래프 */}
        {activeTab === 'attendance' && currentUser?.role === 'ADMIN' && (
          <section className="tab-content text-left">
            <h2>📊 학원 관리 및 출석 통계 리포트</h2>

            {/* 회원수 현황 */}
            <div className="count-grid">
              {(Object.keys(CATEGORY_LABELS) as UserCategory[]).map(catKey => {
                const count = users.filter(u => u.role !== 'ADMIN' && u.category === catKey).length
                return (
                  <div key={catKey} className="count-card">
                    <span className="cat-title">{CATEGORY_LABELS[catKey]}</span>
                    <span className="cat-count">{count}명</span>
                  </div>
                )
              })}
              <div className="count-card total">
                <span className="cat-title">전체 회원 수</span>
                <span className="cat-count">{users.filter(u => u.role !== 'ADMIN').length}명</span>
              </div>
            </div>

            {/* 학원 관리 그래프 섹션 */}
            <div className="analytics-section">
              <h3>📈 학원 관리를 위한 출석 분석 그래프</h3>

              {/* 시간대별 등원 분포 그래프 */}
              <div className="chart-card">
                <h4>⏰ 등원 시간대별 분포 비율</h4>
                <div className="time-bar-container">
                  <div className="time-bar-segment morning" style={{ width: `${attendanceAnalytics.timeDistribution.morningRatio}%` }}>
                    {attendanceAnalytics.timeDistribution.morningRatio > 10 && `오전 ${attendanceAnalytics.timeDistribution.morningRatio}%`}
                  </div>
                  <div className="time-bar-segment afternoon" style={{ width: `${attendanceAnalytics.timeDistribution.afternoonRatio}%` }}>
                    {attendanceAnalytics.timeDistribution.afternoonRatio > 10 && `오후 ${attendanceAnalytics.timeDistribution.afternoonRatio}%`}
                  </div>
                  <div className="time-bar-segment evening" style={{ width: `${attendanceAnalytics.timeDistribution.eveningRatio}%` }}>
                    {attendanceAnalytics.timeDistribution.eveningRatio > 10 && `저녁 ${attendanceAnalytics.timeDistribution.eveningRatio}%`}
                  </div>
                </div>
                <div className="chart-legend">
                  <span className="legend-item morning">오전(~12시): {attendanceAnalytics.timeDistribution.morningCount}회</span>
                  <span className="legend-item afternoon">오후(12~17시): {attendanceAnalytics.timeDistribution.afternoonCount}회</span>
                  <span className="legend-item evening">저녁(17시~): {attendanceAnalytics.timeDistribution.eveningCount}회</span>
                </div>
              </div>

              {/* 요일별 출석 분포 그래프 */}
              <div className="chart-card">
                <h4>🗓️ 요일별 누적 출석 분포</h4>
                <div className="weekday-bar-chart">
                  {['일', '월', '화', '수', '목', '금', '토'].map((dayName, idx) => {
                    const count = attendanceAnalytics.dayOfWeekCounts[idx]
                    const heightPercent = Math.round((count / attendanceAnalytics.maxDayCount) * 100)
                    return (
                      <div key={dayName} className="bar-col">
                        <span className="bar-value">{count}회</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ height: `${heightPercent}%` }}></div>
                        </div>
                        <span className="bar-label">{dayName}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 최근 7일 등원 인원 그래프 */}
              <div className="chart-card">
                <h4>📆 최근 7일간 일별 등원 원생수</h4>
                <div className="recent-trend-grid">
                  {Object.entries(attendanceAnalytics.recent7DaysMap).map(([dateStr, studentSet]) => (
                    <div key={dateStr} className="trend-item">
                      <span className="trend-date">{dateStr.slice(5)}</span>
                      <span className="trend-count">{studentSet.size}명</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 원생별 월/분기/연간 출석일 집계표 */}
            <h2>🗓️ 원생별 주/월/분기/연간 출석일수 요약</h2>
            <div className="table-responsive mb-24">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>이름 (ID)</th>
                    <th>분류</th>
                    <th>이달 출석일</th>
                    <th>분기 출석일</th>
                    <th>올해 출석일</th>
                    <th>총 누적 출석일</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceAnalytics.studentStats.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '16px' }}>원생 정보가 없습니다.</td></tr>
                  ) : (
                    attendanceAnalytics.studentStats.map(st => (
                      <tr key={st.userId}>
                        <td><strong>{st.userName}</strong> ({st.userId})</td>
                        <td>{CATEGORY_LABELS[st.category]}</td>
                        <td><span className="badge-highlight">{st.monthlyDays.size}일</span></td>
                        <td>{st.quarterlyDays.size}일</td>
                        <td>{st.yearlyDays.size}일</td>
                        <td>{st.totalDays.size}일</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 회원 상세 목록 및 탈퇴 */}
            <h2>📋 전체 회원 관리 및 회원 삭제</h2>
            <div className="table-responsive mb-24">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>아이디</th>
                    <th>이름</th>
                    <th>분류</th>
                    <th>좋아하는 것</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => u.role !== 'ADMIN').map(u => (
                    <tr key={u.id}>
                      <td>{u.id}</td>
                      <td>{u.name}</td>
                      <td>{CATEGORY_LABELS[u.category]}</td>
                      <td>{u.reason}</td>
                      <td>
                        <button
                          className="btn-danger-sm"
                          onClick={() => {
                            if (window.confirm(`[${u.name}] 회원을 정말 삭제하시겠습니까? 관련 출석 데이터도 모두 제거됩니다.`)) {
                              deleteUserAndAttendance(u.id)
                            }
                          }}
                        >
                          강제 탈퇴
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 등/하원 출석 기록 필터링 및 조회 */}
            <h2>⏱️ 주/월/분기/연도별 등원 상세 기록</h2>
            <div className="filter-bar">
              <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="select-filter">
                <option value="ALL">전체 카테고리</option>
                {Object.keys(CATEGORY_LABELS).map(k => (
                  <option key={k} value={k}>{CATEGORY_LABELS[k as UserCategory]}</option>
                ))}
              </select>

              <button className={filterMode === 'ALL' ? 'active' : ''} onClick={() => setFilterMode('ALL')}>전체 보기</button>
              <button className={filterMode === 'DAILY' ? 'active' : ''} onClick={() => setFilterMode('DAILY')}>일별</button>
              <button className={filterMode === 'WEEKLY' ? 'active' : ''} onClick={() => setFilterMode('WEEKLY')}>주별</button>
              <button className={filterMode === 'MONTHLY' ? 'active' : ''} onClick={() => setFilterMode('MONTHLY')}>월별</button>
              <button className={filterMode === 'QUARTERLY' ? 'active' : ''} onClick={() => setFilterMode('QUARTERLY')}>분기별</button>
              <button className={filterMode === 'YEARLY' ? 'active' : ''} onClick={() => setFilterMode('YEARLY')}>연간</button>

              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="date-picker-input" />
              <input
                type="text"
                placeholder="학생 이름/ID 검색..."
                value={searchStudentQuery}
                onChange={e => setSearchStudentQuery(e.target.value)}
                className="search-input"
              />
            </div>

            <div className="table-responsive">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>주차</th>
                    <th>분류</th>
                    <th>이름 (ID)</th>
                    <th>등원 시간 (시:분)</th>
                    <th>하원 시간 (시:분)</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredAttendances().length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>출석 기록이 존재하지 않습니다.</td></tr>
                  ) : (
                    getFilteredAttendances().map(a => {
                      const d = new Date(a.date)
                      return (
                        <tr key={a.id}>
                          <td>{a.date}</td>
                          <td>{getWeekNumber(d)}주차</td>
                          <td>{CATEGORY_LABELS[a.userCategory]}</td>
                          <td>{a.userName} ({a.userId})</td>
                          <td><span className="badge-in">{a.checkIn}</span></td>
                          <td>{a.checkOut ? <span className="badge-out">{a.checkOut}</span> : <span className="badge-pending">수업 중</span>}</td>
                        </tr>
                      )
                    })
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