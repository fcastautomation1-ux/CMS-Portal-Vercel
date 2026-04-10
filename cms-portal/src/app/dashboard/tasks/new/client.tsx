'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { CreateTaskModal } from '@/components/tasks/create-task-modal'

interface UserHall {
  cluster_id: string
  cluster_name: string
  department_queue_enabled: boolean
  department_queue_pick_allowed: boolean
  enforce_single_task: boolean
  user_department: string | null
}

export default function NewTaskClient() {
  const router = useRouter()
  const [userCurrentHall, setUserCurrentHall] = useState<UserHall | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Only fetch on client side
    async function fetchHall() {
      try {
        const response = await fetch('/api/tasks/user-current-hall')
        if (response.ok) {
          const data = await response.json()
          setUserCurrentHall(data)
        }
      } catch (error) {
        console.error('Error fetching hall:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchHall()
  }, [])

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <CreateTaskModal
      asPage
      userCurrentHall={userCurrentHall}
      onClose={() => router.push('/dashboard/tasks')}
      onSaved={() => router.push('/dashboard/tasks')}
    />
  )
}
