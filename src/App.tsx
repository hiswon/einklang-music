import React, { useState, useEffect, useMemo, useRef } from 'react'
import './App.css'
import { db } from './firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { QRCodeSVG } from 'qrcode.react'
import { Html5QrcodeScanner } from 'html5-qrcode'

const HEADER_BG = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1200&auto=format&fit=crop'
const CLASS_IMG_1 = 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?q=80&w=800&auto=format&fit=crop'
const CLASS_IMG_3 = 'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?q=80&w=800&auto=format&fit=crop'
const ACADEMY_URL = 'https://einklang-music.vercel.app/'
const GOOGLE_MAPS_URL = 'https://maps.app.goo.gl/4KfQBpEm4k24QkhcA'

export type UserCategory = 'GENERAL' | 'KIDS' | 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'ADULT' | 'PARENT'

export const CATEGORY_LABELS: Record<UserCategory, string> = {
  GENERAL: '일반 (글쓰기 전용)',
  KIDS: '유치부',
  ELEMENTARY: '초등부',
  MIDDLE: '중등부',
  HIGH: '고등부',
  ADULT: '성인부',
  PARENT: '학부모'
}

interface AcademyData {
  schedule: string
  curriculum: string
  events: string
  instructors: string
}

interface StudentNote {
  id: string
  date: string
  content: string
  authorId: string
  createdAt: string
}

interface User {
  id: string
  password: string
  name: string
  reason: string // 좋아하는 음식
  category: UserCategory
  role: 'ADMIN' | 'USER'
  childId?: string // 학부모일 경우 연동된 자녀의 ID
  childName?: string // 가입 시 입력한 자녀 이름
  totalVisits?: number // 전체 접속 횟수
  todayVisits?: number // 오늘 접속 횟수
  lastVisitDate?: string // 마지막 접속 일자 (YYYY-MM-DD)
  notes?: StudentNote[] // 학생 개별 기록
}

interface NoticeData {
  globalNotice: string
  categoryNotices: Partial<Record<UserCategory, string>>
  personalNotices: Record<string, string> // userId -> notice
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
  authorId: string
  authorName: string
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

type TabType = 'about' | 'courses' | 'schedule' | 'instructors' | 'board' | 'classBoard' | 'attendance' | 'qr'
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
  { id: 'jin', password: '12345', name: '진진', reason: '관리자 계정', category: 'GENERAL', role: 'ADMIN', totalVisits: 0, todayVisits: 0 },
  { id: 'rang', password: '67890', name: '관리자2(rang)', reason: '관리자 계정', category: 'GENERAL', role: 'ADMIN', totalVisits: 0, todayVisits: 0 }
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

function getQuarter(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1
}

function getDayOfWeekStr(dateStr: string): string {
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const d = new Date(dateStr)
  return days[d.getDay()]
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('about')

  const [academyData, setAcademyData] = useState<AcademyData>({
    schedule: defaultSchedule,
    curriculum: '',
    events: '',
    instructors: ''
  })
  const [posts, setPosts] = useState<Post[]>([])
  const [classPosts, setClassPosts] = useState<Post[]>([]) // 수업 게시판 게시글
  const [users, setUsers] = useState<User[]>(ADMIN_ACCOUNTS)
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])

  const [notices, setNotices] = useState<NoticeData>({
    globalNotice: '',
    categoryNotices: {},
    personalNotices: {}
  })

  // 새로고침 시 로그인 유지 (Local Storage 세션 관리)
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = sessionStorage.getItem('einklang_current_user')
    return saved ? JSON.parse(saved) : null
  })

  const [showAuthModal, setShowAuthModal] = useState<boolean>(false)
  const [authMode, setAuthMode] = useState<'LOGIN' | 'REGISTER' | 'DELETE_ACCOUNT' | 'EDIT_PROFILE'>('LOGIN')

  const [loginId, setLoginId] = useState('')
  const [loginPw, setLoginPw] = useState('')
  const [regId, setRegId] = useState('')
  const [regPw, setRegPw] = useState('')
  const [regName, setRegName] = useState('')
  const [regReason, setRegReason] = useState('')
  const [regCategory, setRegCategory] = useState<UserCategory>('GENERAL')

  const [regChildId, setRegChildId] = useState('')
  const [regChildName, setRegChildName] = useState('')
  const [regChildFood, setRegChildFood] = useState('')

  const [editId, setEditId] = useState('')
  const [editName, setEditName] = useState('')
  const [editFood, setEditFood] = useState('')
  const [editNewPw, setEditNewPw] = useState('')

  const [delId, setDelId] = useState('')
  const [delPw, setDelPw] = useState('')

  const [showWriteForm, setShowWriteForm] = useState<boolean>(false)
  const [showClassWriteForm, setShowClassWriteForm] = useState<boolean>(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newClassTitle, setNewClassTitle] = useState('')
  const [newClassContent, setNewClassContent] = useState('')

  const [playingPostId, setPlayingPostId] = useState<string | null>(null)
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({})

  // 게시판 페이지네이션 상태
  const [boardPage, setBoardPage] = useState<number>(1)
  const [classBoardPage, setClassBoardPage] = useState<number>(1)
  const ITEMS_PER_PAGE = 5

  // 학생기록 관리 및 페이지네이션 상태
  const [selectedStudentForNote, setSelectedStudentForNote] = useState<string>('')
  const [newNoteContent, setNewNoteContent] = useState<string>('')
  const [studentNotePage, setStudentNotePage] = useState<number>(1)

  const [editForm, setEditForm] = useState<AcademyData>(academyData)
  const [adminMode, setAdminMode] = useState<AdminMode>('VIEW')
  const [qrPassModal, setQrPassModal] = useState<boolean>(false)
  const [qrInputPass, setQrInputPass] = useState('')
  const [targetAdminMode, setTargetAdminMode] = useState<AdminMode>('VIEW')

  const [noticeCategory, setNoticeCategory] = useState<UserCategory>('KIDS')
  const [inputCategoryNotice, setInputCategoryNotice] = useState('')
  const [noticeTargetUserId, setNoticeTargetUserId] = useState('')
  const [inputPersonalNotice, setInputPersonalNotice] = useState('')

  const [filterMode, setFilterMode] = useState<'ALL' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'>('ALL')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [searchStudentQuery, setSearchStudentQuery] = useState('')

  const [scanMessage, setScanMessage] = useState<string>('')
  const [scanMessageType, setScanMessageType] = useState<'in' | 'out' | 'error' | ''>('')

  // 마우스 드래그 스크롤을 위한 Ref 및 상태
  const navRef = useRef<HTMLDivElement>(null)
  const [isMouseDown, setIsMouseDown] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  // 로그인 상태 동기화 (로컬 스토리지)
  useEffect(() => {
    if (currentUser) {
      sessionStorage.setItem('einklang_current_user', JSON.stringify(currentUser))
    } else {
      sessionStorage.removeItem('einklang_current_user')
    }
  }, [currentUser])

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
          if (fetched.classPosts) setClassPosts(fetched.classPosts)
          if (fetched.users) {
            const merged = [...ADMIN_ACCOUNTS]
            fetched.users.forEach((u: User) => {
              if (!merged.find(exist => exist.id === u.id)) merged.push(u)
            })
            setUsers(merged)
            if (currentUser) {
              const updatedCurr = merged.find(u => u.id === currentUser.id)
              if (updatedCurr) setCurrentUser(updatedCurr)
            }
          }
          if (fetched.attendances) setAttendances(fetched.attendances)
          if (fetched.notices) setNotices(fetched.notices)
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
    aList = attendances,
    nData = notices,
    cList = classPosts
  ) => {
    try {
      await setDoc(doc(db, 'academy', 'data'), {
        ...data,
        posts: pList,
        classPosts: cList,
        users: uList.filter(u => u.role !== 'ADMIN'),
        attendances: aList,
        notices: nData
      })
    } catch (e) {
      console.error('Firebase 저장 실패:', e)
    }
  }
  //
  // 1. 학생기록 삭제 함수 추가
  const handleDeleteStudentNote = async (studentId: string, noteId: string) => {
    if (!window.confirm('해당 학생 기록을 삭제하시겠습니까?')) return

    const updatedUsers = users.map(u => {
      if (u.id === studentId) {
        return {
          ...u,
          notes: (u.notes || []).filter(n => n.id !== noteId)
        }
      }
      return u
    })

    setUsers(updatedUsers)
    await saveDataToFirebase(academyData, posts, updatedUsers, attendances, notices, classPosts)
    alert('학생 기록이 삭제되었습니다.')
  }
  //
  // 접속 수 업데이트 함수
  const updateVisitCount = async (user: User) => {
    const todayStr = new Date().toISOString().split('T')[0]
    let isNewDay = user.lastVisitDate !== todayStr

    const updatedUser: User = {
      ...user,
      totalVisits: (user.totalVisits || 0) + 1,
      todayVisits: isNewDay ? 1 : (user.todayVisits || 0) + 1,
      lastVisitDate: todayStr
    }

    const updatedUsers = users.map(u => (u.id === user.id ? updatedUser : u))
    setUsers(updatedUsers)
    setCurrentUser(updatedUser)

    await saveDataToFirebase(academyData, posts, updatedUsers, attendances, notices, classPosts)
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    const target = users.find(u => u.id === loginId && u.password === loginPw)
    if (target) {
      setShowAuthModal(false)
      setLoginId('')
      setLoginPw('')
      if (target.role === 'ADMIN') setAdminMode('VIEW')
      alert(`${target.id}님 환영합니다!`)
      updateVisitCount(target)
    } else {
      alert('아이디 또는 비밀번호가 올바르지 않습니다.')
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regId || !regPw || !regName || !regReason) {
      alert('모든 필수 필드를 입력해 주세요.')
      return
    }
    if (users.some(u => u.id === regId)) {
      alert('이미 존재하는 아이디입니다.')
      return
    }

    let targetChildId: string | undefined = undefined

    if (regCategory === 'PARENT') {
      if (!regChildId || !regChildName || !regChildFood) {
        alert('자녀의 아이디, 이름, 좋아하는 음식을 모두 입력해 주세요.')
        return
      }

      const foundChild = users.find(
        u => u.role !== 'ADMIN' &&
             u.category !== 'GENERAL' &&
             u.category !== 'PARENT' &&
             u.id.trim() === regChildId.trim() &&
             u.name.trim() === regChildName.trim() &&
             u.reason.trim() === regChildFood.trim()
      )

      if (!foundChild) {
        alert('입력하신 자녀 정보(아이디, 이름, 좋아하는 음식)와 일치하는 원생 계정을 찾을 수 없습니다.')
        return
      }

      targetChildId = foundChild.id
    }

    const todayStr = new Date().toISOString().split('T')[0]
    const newUser: User = {
      id: regId.trim(),
      password: regPw.trim(),
      name: regName.trim(),
      reason: regReason.trim(),
      category: regCategory,
      role: 'USER',
      childId: targetChildId,
      childName: regCategory === 'PARENT' ? regChildName.trim() : undefined,
      totalVisits: 1,
      todayVisits: 1,
      lastVisitDate: todayStr,
      notes: []
    }

    const updatedUsers = [...users, newUser]
    setUsers(updatedUsers)
    setCurrentUser(newUser)
    setShowAuthModal(false)

    setRegId(''); setRegPw(''); setRegName(''); setRegReason('')
    setRegChildId(''); setRegChildName(''); setRegChildFood('')

    await saveDataToFirebase(academyData, posts, updatedUsers, attendances, notices, classPosts)
    alert(regCategory === 'PARENT' ? `학부모 가입이 완료되었습니다! (자녀: ${regChildName})` : '회원가입이 완료되었습니다!')
  }

  const handleEditProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentUser) return

    const newId = editId.trim()
    const oldId = currentUser.id

    if (!newId) {
      alert('아이디를 입력해주세요.')
      return
    }

    if (newId !== oldId && users.some(u => u.id === newId)) {
      alert('이미 존재하거나 사용 중인 아이디입니다.')
      return
    }

    const updatedUsers = users.map(u => {
      if (u.id === oldId) {
        return {
          ...u,
          id: newId,
          name: editName.trim() || u.name,
          reason: editFood.trim() || u.reason,
          password: editNewPw.trim() ? editNewPw.trim() : u.password
        }
      }
      if (u.childId === oldId) {
        return { ...u, childId: newId }
      }
      return u
    })

    const updatedUser = updatedUsers.find(u => u.id === newId) || currentUser
    setUsers(updatedUsers)
    setCurrentUser(updatedUser)
    setShowAuthModal(false)
    setEditNewPw('')

    await saveDataToFirebase(academyData, posts, updatedUsers, attendances, notices, classPosts)
    alert('회원 정보 및 아이디가 성공적으로 수정되었습니다!')
  }

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

    if (window.confirm(`정말로 탈퇴하시겠습니까? (${target.id}님의 모든 출석 기록이 삭제됩니다.)`)) {
      await deleteUserAndAttendance(target.id)
      setShowAuthModal(false)
      setDelId(''); setDelPw('')
      if (currentUser?.id === target.id) setCurrentUser(null)
      alert('회원 탈퇴 및 출석 기록 삭제가 완료되었습니다.')
    }
  }

  const deleteUserAndAttendance = async (userId: string) => {
    const updatedUsers = users.filter(u => u.id !== userId)
    const updatedAttendances = attendances.filter(a => a.userId !== userId)

    setUsers(updatedUsers)
    setAttendances(updatedAttendances)
    await saveDataToFirebase(academyData, posts, updatedUsers, updatedAttendances, notices, classPosts)
  }

  // 학생기록 누적 저장
  const handleAddStudentNote = async () => {
    if (!selectedStudentForNote) {
      alert('학생을 선택해 주세요.')
      return
    }
    if (!newNoteContent.trim()) {
      alert('특이사항 내용을 입력해 주세요.')
      return
    }

    const todayStr = new Date().toISOString().split('T')[0]
    const newNote: StudentNote = {
      id: Date.now().toString(),
      date: todayStr,
      content: newNoteContent.trim(),
      authorId: currentUser?.id || 'ADMIN',
      createdAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    }

    const updatedUsers = users.map(u => {
      if (u.id === selectedStudentForNote) {
        return {
          ...u,
          notes: [newNote, ...(u.notes || [])]
        }
      }
      return u
    })

    setUsers(updatedUsers)
    setNewNoteContent('')
    setStudentNotePage(1)
    await saveDataToFirebase(academyData, posts, updatedUsers, attendances, notices, classPosts)
    alert('특이사항이 누적 저장되었습니다.')
  }

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

  const processAttendance = async (scannedUserId: string) => {
    const student = users.find(u => u.id === scannedUserId)
    if (!student) {
      setScanMessage('⚠️ 등록되지 않은 회원 QR코드입니다.')
      setScanMessageType('error')
      return
    }

    if (student.category === 'GENERAL' || student.category === 'PARENT') {
      setScanMessage('⚠️ 출석 대상이 아닌 회원 유형입니다.')
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
      setScanMessage(`[${student.id}] 환영합니다. 등원 완료되었습니다. (${timeStr})`)
      setScanMessageType('in')
    } else {
      const targetRec = updatedList[existingIndex]
      if (targetRec.checkOut) {
        setScanMessage(`[${student.id}] 오늘 등/하원이 이미 완료되었습니다.`)
        setScanMessageType('error')
        return
      }
      updatedList[existingIndex] = { ...targetRec, checkOut: timeStr }
      setScanMessage(`[${student.id}] 안녕히 가세요. 하원 완료되었습니다. (${timeStr})`)
      setScanMessageType('out')
    }

    setAttendances(updatedList)
    await saveDataToFirebase(academyData, posts, users, updatedList, notices, classPosts)
  }

  const handleManualAttendance = async (studentId: string) => {
    const student = users.find(u => u.id === studentId)
    if (!student) return
    await processAttendance(student.id)
  }

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

  // 2. 공지사항 저장 및 실시간 상태 동기화 처리
  const handleSaveGlobalNotice = async (noticeStr: string) => {
    const updated = { ...notices, globalNotice: noticeStr }
    setNotices(updated)
    await saveDataToFirebase(academyData, posts, users, attendances, updated, classPosts)
    alert('전체 공지가 저장/업데이트되었습니다.')
  }

  const handleSaveCategoryNotice = async (cat: UserCategory, noticeStr: string) => {
    const updated = {
      ...notices,
      categoryNotices: { ...notices.categoryNotices, [cat]: noticeStr }
    }
    setNotices(updated)
    await saveDataToFirebase(academyData, posts, users, attendances, updated, classPosts)
    alert('부별 공지가 저장/업데이트되었습니다.')
  }

  const handleSavePersonalNotice = async (targetId: string, noticeStr: string) => {
    const updated = {
      ...notices,
      personalNotices: { ...notices.personalNotices, [targetId]: noticeStr }
    }
    setNotices(updated)
    await saveDataToFirebase(academyData, posts, users, attendances, updated, classPosts)
    alert('개인 맞춤 공지가 저장/업데이트되었습니다.')
  }

  const handleLikePost = async (postId: string, isClass = false) => {
    if (!currentUser) {
      alert('로그인이 필요합니다.')
      return
    }

    const targetList = isClass ? classPosts : posts
    const updated = targetList.map(p => {
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

    if (isClass) setClassPosts(updated)
    else setPosts(updated)

    await saveDataToFirebase(academyData, isClass ? posts : updated, users, attendances, notices, isClass ? updated : classPosts)
  }

  const handleAddComment = async (postId: string, isClass = false) => {
    if (!currentUser) {
      alert('로그인이 필요합니다.')
      return
    }
    const text = commentInputs[postId]?.trim()
    if (!text) return

    const newComment: Comment = {
      id: Date.now().toString(),
      authorId: currentUser.id,
      authorName: currentUser.name,
      text: text,
      createdAt: new Date().toLocaleDateString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    const targetList = isClass ? classPosts : posts
    const updated = targetList.map(p => {
      if (p.id === postId) {
        return { ...p, comments: [newComment, ...(p.comments || [])] }
      }
      return p
    })

    if (isClass) setClassPosts(updated)
    else setPosts(updated)

    setCommentInputs(prev => ({ ...prev, [postId]: '' }))
    await saveDataToFirebase(academyData, isClass ? posts : updated, users, attendances, notices, isClass ? updated : classPosts)
  }

  const handleDeleteComment = async (postId: string, comment: Comment, isClass = false) => {
    if (!currentUser) return
    if (currentUser.role === 'ADMIN' || currentUser.id === comment.authorId) {
      const targetList = isClass ? classPosts : posts
      const updated = targetList.map(p => {
        if (p.id === postId) {
          return { ...p, comments: p.comments.filter(c => c.id !== comment.id) }
        }
        return p
      })
      if (isClass) setClassPosts(updated)
      else setPosts(updated)
      await saveDataToFirebase(academyData, isClass ? posts : updated, users, attendances, notices, isClass ? updated : classPosts)
    }
  }

  const handleDeletePost = async (post: Post, isClass = false) => {
    if (!currentUser) return
    if (currentUser.role === 'ADMIN' || currentUser.id === post.authorId) {
      if (window.confirm('정말 삭제하시겠습니까?')) {
        if (isClass) {
          const updated = classPosts.filter(p => p.id !== post.id)
          setClassPosts(updated)
          await saveDataToFirebase(academyData, posts, users, attendances, notices, updated)
        } else {
          const updated = posts.filter(p => p.id !== post.id)
          setPosts(updated)
          await saveDataToFirebase(academyData, updated, users, attendances, notices, classPosts)
        }
      }
    }
  }

  const handleCreatePost = async (e: React.FormEvent, isClass = false) => {
    e.preventDefault()
    if (!currentUser) return
    const title = isClass ? newClassTitle : newTitle
    const content = isClass ? newClassContent : newContent

    if (!title.trim() || !content.trim()) {
      alert('제목과 내용을 입력하세요.')
      return
    }

    const newPost: Post = {
      id: Date.now().toString(),
      authorId: currentUser.id,
      authorName: currentUser.name,
      title: title.trim(),
      content: content.trim(),
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

    if (isClass) {
      const updated = [newPost, ...classPosts]
      setClassPosts(updated)
      setNewClassTitle(''); setNewClassContent('')
      setShowClassWriteForm(false)
      await saveDataToFirebase(academyData, posts, users, attendances, notices, updated)
    } else {
      const updated = [newPost, ...posts]
      setPosts(updated)
      setNewTitle(''); setNewContent('')
      setShowWriteForm(false)
      await saveDataToFirebase(academyData, updated, users, attendances, notices, classPosts)
    }
  }

  // 마우스 드래그 스크롤 핸들러
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!navRef.current) return
    setIsMouseDown(true)
    setStartX(e.pageX - navRef.current.offsetLeft)
    setScrollLeft(navRef.current.scrollLeft)
  }

  const handleMouseLeave = () => {
    setIsMouseDown(false)
  }

  const handleMouseUp = () => {
    setIsMouseDown(false)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDown || !navRef.current) return
    e.preventDefault()
    const x = e.pageX - navRef.current.offsetLeft
    const walk = (x - startX) * 2
    navRef.current.scrollLeft = scrollLeft - walk
  }

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

  const attendanceAnalytics = useMemo(() => {
    const now = new Date(selectedDate)
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth()
    const currentQuarter = getQuarter(now)

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

    users.filter(u => u.role !== 'ADMIN' && u.category !== 'GENERAL' && u.category !== 'PARENT').forEach(u => {
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

    let morningCount = 0
    let afternoonCount = 0
    let eveningCount = 0
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]

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
        if (quarter === currentQuarter) st.quarterlyDays.add(a.date)
        if (month === currentMonth) st.monthlyDays.add(a.date)
      }

      if (a.checkIn) {
        st.checkInTimes.push(a.checkIn)
        const hour = parseInt(a.checkIn.split(':')[0], 10)
        if (hour < 12) morningCount++
        else if (hour < 17) afternoonCount++
        else eveningCount++
      }

      const dayIdx = aDate.getDay()
      dayOfWeekCounts[dayIdx]++

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

  const renderUserNotices = (targetUser: User, isParentView: boolean) => {
    const activeNotices: { type: string; text: string }[] = []

    if (notices.globalNotice?.trim()) {
      activeNotices.push({ type: '🌐 전체 공지', text: notices.globalNotice })
    }

    if (notices.categoryNotices[targetUser.category]?.trim()) {
      activeNotices.push({
        type: `📢 ${CATEGORY_LABELS[targetUser.category]} 공지`,
        text: notices.categoryNotices[targetUser.category]!
      })
    }

    if (isParentView && currentUser && notices.personalNotices[currentUser.id]?.trim()) {
      activeNotices.push({ type: '💌 학부모 개인 공지', text: notices.personalNotices[currentUser.id]! })
    }

    if (!isParentView && notices.personalNotices[targetUser.id]?.trim()) {
      activeNotices.push({ type: '💌 개인 맞춤 공지', text: notices.personalNotices[targetUser.id]! })
    }

    if (activeNotices.length === 0) return null

    return (
      <div className="qr-notices-container">
        <h4>📢 전달사항 / 공지사항</h4>
        {activeNotices.map((n, i) => (
          <div key={i} className="qr-notice-card">
            <span className="notice-tag">{n.type}</span>
            <p className="notice-content">{n.text}</p>
          </div>
        ))}
      </div>
    )
  }

  // 사용자 수업게시판 접근 권한 판별
  const canAccessClassBoard = currentUser && (currentUser.role === 'ADMIN' || currentUser.category !== 'GENERAL')

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
            <p className="subtitle">나만의 감성을 연주하다 · 보컬 | <br className="mobile-break" /> 통기타 & 핑거스타일 | 미디 & 작곡</p>
          </div>
        </div>

        <div className="admin-bar">
          {currentUser ? (
            <div className="user-info-bar">
              <span>
                <strong>{currentUser.id}</strong>({currentUser.name}) [{currentUser.role === 'ADMIN' ? '관리자' : CATEGORY_LABELS[currentUser.category]}]
                <span className="visit-badge">👁️ 전체 접속: {currentUser.totalVisits || 1}회 / 오늘: {currentUser.todayVisits || 1}회</span>
              </span>

              <button
                className="admin-btn edit-profile-btn"
                onClick={() => {
                  setEditId(currentUser.id)
                  setEditName(currentUser.name)
                  setEditFood(currentUser.reason)
                  setEditNewPw('')
                  setAuthMode('EDIT_PROFILE')
                  setShowAuthModal(true)
                }}
              >
                ✏️ 회원정보 수정
              </button>

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

      {/* Auth 및 프로필 수정 모달 */}
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>
              {authMode === 'LOGIN' && '로그인'}
              {authMode === 'REGISTER' && '회원가입'}
              {authMode === 'EDIT_PROFILE' && '회원정보 수정'}
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
                    <option value="PARENT">학부모</option>
                  </select>
                </label>

                {regCategory === 'PARENT' ? (
                  <>
                    <input
                      type="text"
                      placeholder="자녀 아이디 (정확한 ID 입력)"
                      value={regChildId}
                      onChange={e => setRegChildId(e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      placeholder="자녀 이름"
                      value={regChildName}
                      onChange={e => setRegChildName(e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      placeholder="자녀가 좋아하는 음식 (가입 정보 일치 확인용)"
                      value={regChildFood}
                      onChange={e => setRegChildFood(e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      placeholder="학부모님이 좋아하는 음식"
                      value={regReason}
                      onChange={e => setRegReason(e.target.value)}
                      required
                    />
                  </>
                ) : (
                  <textarea
                    placeholder="당신이 좋아하는 음식은 무엇입니까?"
                    value={regReason}
                    onChange={e => setRegReason(e.target.value)}
                    className="modal-textarea"
                    required
                  />
                )}

                <div className="modal-buttons">
                  <button type="submit" className="btn-confirm">가입 완료</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowAuthModal(false)}>취소</button>
                </div>
                <div className="auth-switch-links">
                  <span onClick={() => setAuthMode('LOGIN')}>로그인으로 이동</span>
                </div>
              </form>
            )}

            {authMode === 'EDIT_PROFILE' && (
              <form onSubmit={handleEditProfile}>
                <label className="input-label">아이디 (수정 가능)</label>
                <input type="text" value={editId} onChange={e => setEditId(e.target.value)} required />

                <label className="input-label">이름</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required />

                <label className="input-label">좋아하는 음식</label>
                <input type="text" value={editFood} onChange={e => setEditFood(e.target.value)} required />

                <label className="input-label">새 비밀번호 (변경시에만 입력)</label>
                <input
                  type="password"
                  placeholder="변경할 새 비밀번호"
                  value={editNewPw}
                  onChange={e => setEditNewPw(e.target.value)}
                />

                <div className="modal-buttons">
                  <button type="submit" className="btn-confirm">수정 완료</button>
                  <button type="button" className="btn-cancel" onClick={() => setShowAuthModal(false)}>취소</button>
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

      {/* 네비게이션 (마우스 드래그 스크롤 지원) */}
      <nav
        className="academy-nav"
        ref={navRef}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      >
        <button className={activeTab === 'about' ? 'active' : ''} onClick={() => setActiveTab('about')}>학원소개</button>
        <button className={activeTab === 'courses' ? 'active' : ''} onClick={() => setActiveTab('courses')}>수강과목</button>
        <button className={activeTab === 'schedule' ? 'active' : ''} onClick={() => setActiveTab('schedule')}>이달의 일정</button>
        <button className={activeTab === 'instructors' ? 'active' : ''} onClick={() => setActiveTab('instructors')}>강사진</button>
        <button className={activeTab === 'board' ? 'active' : ''} onClick={() => setActiveTab('board')}>자유 게시판</button>

        {canAccessClassBoard && (
          <button className={activeTab === 'classBoard' ? 'active' : ''} onClick={() => setActiveTab('classBoard')}>
            🎓 수업 게시판
          </button>
        )}

        {currentUser && currentUser.role === 'USER' && currentUser.category !== 'GENERAL' && (
          <button className={activeTab === 'qr' ? 'active' : ''} onClick={() => setActiveTab('qr')}>
            📱 {currentUser.category === 'PARENT' ? '자녀 QR코드 & 등하원' : '내 QR코드 & 출석'}
          </button>
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
        {/* 3. 관리자 수정모드에서 '강사진'도 수정 가능하도록 항목 확장 */}
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
            <label>
              <strong>강사진 정보 수정:</strong>
              <textarea rows={3} value={editForm.instructors} onChange={e => setEditForm({ ...editForm, instructors: e.target.value })} placeholder="예: 통기타/핑거스타일/ 원장 실용음악과 전공&#10;;보컬 트레이닝/ 보컬 수석 강사" />
            </label>
            <button className="save-btn" onClick={async () => {
              await saveDataToFirebase(editForm, posts, users, attendances, notices, classPosts)
              setAcademyData(editForm)
              alert('이달의 일정, 커리큘럼, 강사진 수정사항이 저장되었습니다!')
            }}>💾 변경사항 저장하기</button>
          </div>
        )}

        {/* 학원 소개 */}
        {activeTab === 'about' && (
          <section className="tab-content">
            <h2>🎧 아인클랑과 함께하는 <br className="mobile-break" />음악 퍼포먼스</h2>
            <div className="video-container">
              <iframe src="https://www.youtube.com/embed/QzKwMGicdwU" title="Performance" allowFullScreen></iframe>
            </div>

            <div className="location-box">
              <h3>📍오시는 길</h3>
              <p className="location-address">📌 울산 남구 무거동 옥현로 21 3층 <br className="mobile-break" />(월계초 앞)</p>
              <div className="location-actions">
                <a
                  href={GOOGLE_MAPS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="map-link-btn"
                >
                  🗺️ Google 지도에서 보기
                </a>
              </div>

              <div className="map-iframe-wrapper">
                <iframe
                  title="Google Maps Location"
                  src="https://www.google.com/maps/embed?pb=!1m5!3m3!1m2!1s0x35662d934d7d169f%3A0x400bd06b53cf9486!2z7JWE7J247YG0656R7J2M7JWF7ZWZ7JuQ!5e0!3m2!1sko!2skr!4v1789316730739!5m2!1sko!2skr"
                  width="100%"
                  height="260"
                  style={{ border: 0, borderRadius: '12px' }}
                  allowFullScreen={false}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                ></iframe>
              </div>
            </div>

            <div className="site-qr-box">
              <h3>📱 아인클랑 스마트폰 연결 QR</h3>
              <p>카메라로 아래 QR을 스캔하면 바로 모바일 웹사이트로 연결됩니다.</p>
              <QRCodeSVG value={ACADEMY_URL} size={160} level="H" className="site-qr-img" />
              <a href={ACADEMY_URL} target="_blank" rel="noreferrer" className="site-url-link">{ACADEMY_URL}</a>
            </div>
          </section>
        )}

        {/* 수강 과목 */}
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

        {/* 이달의 일정 */}
        {activeTab === 'schedule' && (
          <section className="tab-content text-left">
            <h2>📅 이달의 레슨 & 라이브 일정</h2>
            {renderFormattedContent(academyData.schedule)}
          </section>
        )}

        {/* 강사진 */}
        {activeTab === 'instructors' && (
          <section className="tab-content text-left">
            <h2>👥 프로 아티스트 강사진</h2>
            {renderFormattedContent(
              academyData.instructors || `통기타/핑거스타일/ 원장 실용음악과 아쿠스틱 기타 전공\n;보컬 트레이닝/ 보컬 수석 강사`
            )}
          </section>
        )}

        {/* 자유 게시판 */}
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
              <form className="post-create-form" onSubmit={e => handleCreatePost(e, false)}>
                <h3>✍️ 글 작성 (작성자: {currentUser.id})</h3>
                <input type="text" placeholder="제목" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="input-field mb-12" required />
                <textarea rows={4} placeholder="내용을 입력하세요. (유튜브 주소나 이미지 URL 포함 가능)" value={newContent} onChange={e => setNewContent(e.target.value)} className="input-field text-area" required />
                <button type="submit" className="submit-post-btn">📌 등록하기</button>
              </form>
            )}

            <div className="posts-list">
              {posts.slice((boardPage - 1) * ITEMS_PER_PAGE, boardPage * ITEMS_PER_PAGE).map(post => {
                const currInput = commentInputs[post.id] || ''
                const canDelete = currentUser && (currentUser.role === 'ADMIN' || currentUser.id === post.authorId)
                const isLiked = currentUser && post.likedUsers?.includes(currentUser.id)

                return (
                  <article key={post.id} className="post-card">
                    <div className="post-header">
                      <div className="post-header-main">
                        <h3 className="post-title">{post.title}</h3>
                        <span className="post-date">아이디: {post.authorId} · {post.createdAt}</span>
                      </div>
                      {canDelete && (
                        <button className="delete-btn" onClick={() => handleDeletePost(post, false)}>🗑️ 삭제</button>
                      )}
                    </div>

                    {renderPostContent(post.id, post.content)}

                    <div className="post-actions">
                      <button
                        className={`like-btn ${isLiked ? 'liked' : ''}`}
                        onClick={() => handleLikePost(post.id, false)}
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
                              onKeyDown={e => e.key === 'Enter' && handleAddComment(post.id, false)}
                              className="comment-text-input"
                            />
                            <button type="button" className="add-comment-btn" onClick={() => handleAddComment(post.id, false)}>등록</button>
                          </div>
                        </div>
                      )}

                      <div className="comments-list">
                        {post.comments?.map(c => (
                          <div key={c.id} className="comment-item">
                            <div className="comment-main-info">
                              <div className="comment-header-row">
                                <span className="comment-author">{c.authorId}</span>
                                <span className="comment-date">{c.createdAt}</span>
                              </div>
                              <div className="comment-text">{c.text}</div>
                            </div>
                            {(currentUser?.role === 'ADMIN' || currentUser?.id === c.authorId) && (
                              <button className="comment-del-btn" onClick={() => handleDeleteComment(post.id, c, false)}>✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            {posts.length > ITEMS_PER_PAGE && (
              <div className="pagination-container">
                {Array.from({ length: Math.ceil(posts.length / ITEMS_PER_PAGE) }).map((_, idx) => (
                  <button
                    key={idx}
                    className={`page-btn ${boardPage === idx + 1 ? 'active' : ''}`}
                    onClick={() => setBoardPage(idx + 1)}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 수업 게시판 */}
        {activeTab === 'classBoard' && canAccessClassBoard && (
          <section className="tab-content text-left">
            <div className="board-top-header">
              <h2>🎓 수업 게시판 (학생 & 학부모 전용)</h2>
              <button className="toggle-write-btn" onClick={() => setShowClassWriteForm(!showClassWriteForm)}>
                {showClassWriteForm ? '❌ 작성 창 닫기' : '✍️ 수업 게시글 작성'}
              </button>
            </div>

            {showClassWriteForm && (
              <form className="post-create-form" onSubmit={e => handleCreatePost(e, true)}>
                <h3>✍️ 수업 게시글 작성 (작성자: {currentUser.id})</h3>
                <input type="text" placeholder="제목" value={newClassTitle} onChange={e => setNewClassTitle(e.target.value)} className="input-field mb-12" required />
                <textarea rows={4} placeholder="수업 관련 질의응답이나 내용을 작성해 주세요." value={newClassContent} onChange={e => setNewClassContent(e.target.value)} className="input-field text-area" required />
                <button type="submit" className="submit-post-btn">📌 등록하기</button>
              </form>
            )}

            <div className="posts-list">
              {classPosts.length === 0 ? (
                <p className="empty-text">등록된 수업 관련 게시물이 없습니다.</p>
              ) : (
                classPosts.slice((classBoardPage - 1) * ITEMS_PER_PAGE, classBoardPage * ITEMS_PER_PAGE).map(post => {
                  const currInput = commentInputs[post.id] || ''
                  const canDelete = currentUser && (currentUser.role === 'ADMIN' || currentUser.id === post.authorId)
                  const isLiked = currentUser && post.likedUsers?.includes(currentUser.id)

                  return (
                    <article key={post.id} className="post-card">
                      <div className="post-header">
                        <div className="post-header-main">
                          <h3 className="post-title">{post.title}</h3>
                          <span className="post-date">아이디: {post.authorId} · {post.createdAt}</span>
                        </div>
                        {canDelete && (
                          <button className="delete-btn" onClick={() => handleDeletePost(post, true)}>🗑️ 삭제</button>
                        )}
                      </div>

                      {renderPostContent(post.id, post.content)}

                      <div className="post-actions">
                        <button
                          className={`like-btn ${isLiked ? 'liked' : ''}`}
                          onClick={() => handleLikePost(post.id, true)}
                        >
                          ❤️ 좋아요 {post.likes || 0}
                        </button>
                      </div>

                      <div className="comments-section">
                        <h4>💬 댓글 ({post.comments?.length || 0})</h4>

                        <div className="comment-form-grid">
                          <div className="comment-inputs-bottom">
                            <input
                              type="text"
                              placeholder="댓글을 입력하세요..."
                              value={currInput}
                              onChange={e => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
                              onKeyDown={e => e.key === 'Enter' && handleAddComment(post.id, true)}
                              className="comment-text-input"
                            />
                            <button type="button" className="add-comment-btn" onClick={() => handleAddComment(post.id, true)}>등록</button>
                          </div>
                        </div>

                        <div className="comments-list">
                          {post.comments?.map(c => (
                            <div key={c.id} className="comment-item">
                              <div className="comment-main-info">
                                <div className="comment-header-row">
                                  <span className="comment-author">{c.authorId}</span>
                                  <span className="comment-date">{c.createdAt}</span>
                                </div>
                                <div className="comment-text">{c.text}</div>
                              </div>
                              {(currentUser?.role === 'ADMIN' || currentUser?.id === c.authorId) && (
                                <button className="comment-del-btn" onClick={() => handleDeleteComment(post.id, c, true)}>✕</button>
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

            {classPosts.length > ITEMS_PER_PAGE && (
              <div className="pagination-container">
                {Array.from({ length: Math.ceil(classPosts.length / ITEMS_PER_PAGE) }).map((_, idx) => (
                  <button
                    key={idx}
                    className={`page-btn ${classBoardPage === idx + 1 ? 'active' : ''}`}
                    onClick={() => setClassBoardPage(idx + 1)}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 학생/학부모 QR 확인 및 일일 누적 특이사항 확인 */}
        {activeTab === 'qr' && currentUser?.role === 'USER' && currentUser.category !== 'GENERAL' && (
          <section className="tab-content text-center">
            {(() => {
              const targetUser = currentUser.category === 'PARENT' && currentUser.childId
                ? users.find(u => u.id === currentUser.childId) || currentUser
                : currentUser

              const isParentView = currentUser.category === 'PARENT'
              const today = new Date()

              // 1. 작성자 표시 제거 및 학생기록란 5개씩 페이지네이션
              const userNotes = targetUser.notes || []
              const totalNotePages = Math.ceil(userNotes.length / ITEMS_PER_PAGE)
              const paginatedNotes = userNotes.slice((studentNotePage - 1) * ITEMS_PER_PAGE, studentNotePage * ITEMS_PER_PAGE)

              return (
                <>
                  <h2>📱 {isParentView ? `자녀 [${targetUser.name}] 원생 QR 코드 및 등하원 현황` : '나의 출석 QR 코드 및 출석 통계'}</h2>
                  <div className="qr-container">
                    <QRCodeSVG
                      value={JSON.stringify({ studentId: targetUser.id, name: targetUser.name })}
                      size={200}
                      level="H"
                    />
                    <h3>
                      {targetUser.name} 원생 ({CATEGORY_LABELS[targetUser.category]})
                      {isParentView && <span className="parent-tag"> (학부모 연동)</span>}
                    </h3>
                  </div>

                  {renderUserNotices(targetUser, isParentView)}

                  {/* 학생 본인 접속시에만 누적 기록/특이사항 출력 (부모는 보이지 않음) */}
                  {!isParentView && (
                    <div className="student-notes-box">
                      <h3>📝 나의 일일 누적 특이사항</h3>
                      {userNotes.length === 0 ? (
                        <p className="empty-text">등록된 특이사항 기록이 없습니다.</p>
                      ) : (
                        <>
                          <div className="notes-list">
                            {paginatedNotes.map(note => (
                              <div key={note.id} className="note-card">
                                <div className="note-header">
                                  <span className="note-date">📅 {note.date} ({note.createdAt})</span>
                                </div>
                                <p className="note-body">{note.content}</p>
                              </div>
                            ))}
                          </div>

                          {totalNotePages > 1 && (
                            <div className="pagination-container">
                              {Array.from({ length: totalNotePages }).map((_, idx) => (
                                <button
                                  key={idx}
                                  className={`page-btn ${studentNotePage === idx + 1 ? 'active' : ''}`}
                                  onClick={() => setStudentNotePage(idx + 1)}
                                >
                                  {idx + 1}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {(() => {
                    const myStats = attendanceAnalytics.studentStats.find(s => s.userId === targetUser.id)
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
                    <h3>📅 {isParentView ? `[${targetUser.name}] 자녀 등하원 상세 기록` : '내 최근 출석 및 등원 시간 상세'}</h3>
                    <table className="attendance-table">
                      <thead>
                        <tr>
                          <th>날짜 / 요일</th>
                          <th>주차</th>
                          <th>등원 현황</th>
                          <th>하원 현황</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendances.filter(a => a.userId === targetUser.id).length === 0 ? (
                          <tr><td colSpan={4}>출석 기록이 없습니다.</td></tr>
                        ) : (
                          attendances.filter(a => a.userId === targetUser.id).map(a => {
                            const attDate = new Date(a.date)
                            const diffTime = Math.abs(today.getTime() - attDate.getTime())
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
                            const isWithin7Days = diffDays <= 7

                            return (
                              <tr key={a.id}>
                                <td>{a.date} ({getDayOfWeekStr(a.date)})</td>
                                <td>{getWeekNumber(attDate)}주차</td>
                                {isWithin7Days ? (
                                  <>
                                    <td><span className="badge-in">{a.checkIn}</span></td>
                                    <td>{a.checkOut ? <span className="badge-out">{a.checkOut}</span> : <span className="badge-pending">수업 중</span>}</td>
                                  </>
                                ) : (
                                  <td colSpan={2} style={{ textAlign: 'center', color: '#4ade80' }}>
                                    ✅ 출석 완료
                                  </td>
                                )}
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            })()}
          </section>
        )}

        {/* 관리자 QR 스캐너 */}
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

        {/* 관리자 통계 및 출석/회원 관리 / 학생 기록란 */}
        {activeTab === 'attendance' && currentUser?.role === 'ADMIN' && (
          <section className="tab-content text-left">
            
            {/* 1. 학생 기록란 (작성자 제거 & 5개 단위 페이지네이션 추가) */}
            <h2>📝 학생기록란 (일일 특이사항 누적 작성)</h2>
            <div className="student-note-management-box">
              <div className="input-group mb-12">
                <select
                  value={selectedStudentForNote}
                  onChange={e => {
                    setSelectedStudentForNote(e.target.value)
                    setStudentNotePage(1)
                  }}
                  className="select-filter"
                >
                  <option value="">-- 학생(원생) 선택 --</option>
                  {users.filter(u => u.role !== 'ADMIN' && u.category !== 'GENERAL' && u.category !== 'PARENT').map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id} / {CATEGORY_LABELS[s.category]})
                    </option>
                  ))}
                </select>
              </div>

              {selectedStudentForNote && (() => {
                const selectedUser = users.find(u => u.id === selectedStudentForNote)
                const notesList = selectedUser?.notes || []
                const totalNotePages = Math.ceil(notesList.length / ITEMS_PER_PAGE)
                const currentNotes = notesList.slice((studentNotePage - 1) * ITEMS_PER_PAGE, studentNotePage * ITEMS_PER_PAGE)

                return (
                  <div className="note-write-container">
                    <textarea
                      rows={3}
                      placeholder="해당 학생의 일일 특이사항, 수업 진도, 상담 내용 등을 입력하세요..."
                      value={newNoteContent}
                      onChange={e => setNewNoteContent(e.target.value)}
                      className="input-field mb-12"
                    />
                    <button onClick={handleAddStudentNote} className="submit-post-btn mb-12">💾 특이사항 누적 저장</button>

                    <h4>📋 [{selectedUser?.name}] 학생 누적 기록 목록</h4>
                    <div className="notes-list">
                      {notesList.length === 0 ? (
                        <p className="empty-text">저장된 특이사항이 없습니다.</p>
                      ) : (
                        currentNotes.map(note => (
                          <div key={note.id} className="note-card">
                            <div className="note-header">
                              <span className="note-date">📅 {note.date} ({note.createdAt})</span>
                              <button 
                                className="btn-danger-sm" 
                                onClick={() => handleDeleteStudentNote(selectedStudentForNote, note.id)}
                              >
                                삭제
                              </button>
                            </div>
                            <p className="note-body">{note.content}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {totalNotePages > 1 && (
                      <div className="pagination-container mb-12">
                        {Array.from({ length: totalNotePages }).map((_, idx) => (
                          <button
                            key={idx}
                            className={`page-btn ${studentNotePage === idx + 1 ? 'active' : ''}`}
                            onClick={() => setStudentNotePage(idx + 1)}
                          >
                            {idx + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* 2. 공지사항 실시간 업데이트 반영 */}
            <h2>📢 회원 QR 바코드 밑 공지사항 작성</h2>
            <div className="notice-management-box">
              <div className="notice-editor-card">
                <h4>🌐 전체 공지 (모든 회원 QR 밑에 표시)</h4>
                <div className="input-group">
                  <input
                    type="text"
                    placeholder="전체공지 입력"
                    value={notices.globalNotice || ''}
                    onChange={e => setNotices({ ...notices, globalNotice: e.target.value })}
                  />
                  <button onClick={() => handleSaveGlobalNotice(notices.globalNotice || '')}>저장</button>
                </div>
              </div>

              <div className="notice-editor-card">
                <h4>📢 부별 공지 (해당 부서 회원 QR 밑에 표시)</h4>
                <div className="input-group">
                  <select value={noticeCategory} onChange={e => {
                    const cat = e.target.value as UserCategory
                    setNoticeCategory(cat)
                    setInputCategoryNotice(notices.categoryNotices[cat] || '')
                  }}>
                    {Object.keys(CATEGORY_LABELS).map(k => (
                      <option key={k} value={k}>{CATEGORY_LABELS[k as UserCategory]}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="부별공지 입력"
                    value={inputCategoryNotice}
                    onChange={e => setInputCategoryNotice(e.target.value)}
                  />
                  <button onClick={() => handleSaveCategoryNotice(noticeCategory, inputCategoryNotice)}>저장</button>
                </div>
              </div>

              <div className="notice-editor-card">
                <h4>💌 개인별 공지 (해당 회원/자녀/학부모 QR 밑에 표시)</h4>
                <div className="input-group">
                  <select value={noticeTargetUserId} onChange={e => {
                    const id = e.target.value
                    setNoticeTargetUserId(id)
                    setInputPersonalNotice(notices.personalNotices[id] || '')
                  }}>
                    <option value="">-- 회원 선택 --</option>
                    {users.filter(u => u.role !== 'ADMIN').map(u => (
                      <option key={u.id} value={u.id}>
                        {u.id} ({u.name} / {CATEGORY_LABELS[u.category]})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="개인공지 입력"
                    value={inputPersonalNotice}
                    onChange={e => setInputPersonalNotice(e.target.value)}
                  />
                  <button onClick={() => {
                    if (!noticeTargetUserId) {
                      alert('대상 회원을 선택하세요.')
                      return
                    }
                    handleSavePersonalNotice(noticeTargetUserId, inputPersonalNotice)
                  }}>저장</button>
                </div>
              </div>
            </div>

            <h2>📊 학원 관리 및 출석 통계 리포트</h2>
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
              <div className="count-card student-total">
                <span className="cat-title">🎓학생수</span>
                <span className="cat-count">
                  {users.filter(u => u.role !== 'ADMIN' && u.category !== 'GENERAL' && u.category !== 'PARENT').length}명
                </span>
              </div>
              <div className="count-card total">
                <span className="cat-title">전체 회원 수</span>
                <span className="cat-count">{users.filter(u => u.role !== 'ADMIN').length}명</span>
              </div>
            </div>

            <div className="analytics-section">
              <h3>📈 출석 분석 그래프</h3>

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
            </div>

            <h2>📋 원생 수동 등하원 체크 및 회원 접속 통계 관리</h2>
            <div className="table-responsive mb-24">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>이름</th>
                    <th>분류</th>
                    <th>접속(전체/오늘)</th>
                    <th>수동체크</th>
                    <th>탈퇴</th>
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => u.role !== 'ADMIN').map(u => {
                    const todayStr = new Date().toISOString().split('T')[0]
                    const todayRec = attendances.find(a => a.userId === u.id && a.date === todayStr)
                    const isAttending = u.category !== 'GENERAL' && u.category !== 'PARENT'

                    return (
                      <tr key={u.id}>
                        <td>{u.id}</td>
                        <td>
                          <strong>{u.name}</strong>
                          {u.childName && <span className="child-badge"> (자녀: {u.childName})</span>}
                        </td>
                        <td>{CATEGORY_LABELS[u.category]}</td>
                        <td>
                          <span className="visit-badge-table">
                            {u.totalVisits || 1}회/{u.lastVisitDate === todayStr ? (u.todayVisits || 1) : 0}회
                          </span>
                        </td>
                        <td>
                          {isAttending ? (
                            <button
                              className={`btn-manual-check ${todayRec ? (todayRec.checkOut ? 'completed' : 'checkout') : 'checkin'}`}
                              onClick={() => handleManualAttendance(u.id)}
                            >
                              {!todayRec ? '🔔 수동 등원 체크' : (!todayRec.checkOut ? '🚪 수동 하원 체크' : '✅ 오늘 등하원 완료')}
                            </button>
                          ) : (
                            <span className="badge-pending">출석 대상 아님</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn-danger-sm"
                            onClick={() => {
                              if (window.confirm(`[${u.id}] 회원을 정말 삭제하시겠습니까? 관련 출석 데이터도 모두 제거됩니다.`)) {
                                deleteUserAndAttendance(u.id)
                              }
                            }}
                          >
                            강제 탈퇴
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

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
                    <th>이름(ID)</th>
                    <th>등원시간</th>
                    <th>하원시간</th>
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
                          <td>{getWeekNumber(d)}주</td>
                          <td>{CATEGORY_LABELS[a.userCategory]}</td>
                          <td>{a.userName} ({a.userId})</td>
                          <td><span className="badge-in">{a.checkIn}</span></td>
                          {/* <td>{a.checkOut ? <span className="badge-out">{a.checkOut}</span> : <span className="badge-pending">수업 중</span>}</td> */}
                          <td>{(() => {
                                const todayStr = new Date().toISOString().split('T')[0];
                                const isToday = a.date === todayStr;

                                if (a.checkOut) {
                                  return <span className="badge-out">{a.checkOut} (하원)</span>;
                                } else if (isToday) {
                                  return <span className="badge-pending">수업중</span>;
                                } else {
                                  return <span className="badge-danger" style={{ color: '#f87171' }}>체크안됨</span>;
                                }
                              })()}
                          </td>
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