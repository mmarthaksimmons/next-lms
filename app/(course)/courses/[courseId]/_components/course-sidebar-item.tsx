'use client'

import { CheckCircleIcon, LockIcon, PlayCircleIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type CourseSidebarItemProps = {
  id: string
  label: string
  isCompleted: boolean
  courseId: string
  isLocked: boolean
}

export default function CourseSidebarItem({ id, label, isCompleted, courseId, isLocked }: CourseSidebarItemProps) {
  const pathname = usePathname()
  const router = useRouter()

  const Icon = isLocked ? LockIcon : isCompleted ? CheckCircleIcon : PlayCircleIcon

  const isActive = pathname?.includes(id)

  const onClick = () => {
    router.push(`/courses/${courseId}/chapters/${id}`)
  }

  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        'flex items-center gap-x-2 pl-6 text-sm font-medium transition-all hover:text-slate-600',
        {
          'text-slate-500 hover:bg-slate-300/20': !isActive && !isCompleted,
          'bg-slate-200/20 text-slate-700 hover:bg-slate-200/20 hover:text-slate-700': isActive && !isCompleted,
          'text-emerald-700 hover:text-emerald-700 hover:bg-emerald-300/20': isCompleted && !isActive,
          'bg-emerald-200/20 text-emerald-700 hover:bg-emerald-200/20 hover:text-emerald-700': isCompleted && isActive,
        },
      )}
    >
      <div className="flex items-center gap-x-2 py-4 rounded-md">
        <Icon
          size={22}
          className={cn('text-slate-500', { 'text-slate-700': isActive, 'text-emerald-700': isCompleted })}
        />
        {label}
      </div>

      <div
        className={cn('ml-auto h-full w-1 border-r-2 border-slate-700 opacity-0 transition-all', {
          'opacity-100': isActive,
          'border-emerald-700': isCompleted && !isActive,
          'border-slate-700': isActive,
        })}
      />
    </button>
  )
}
