import Image from 'next/image'
import Link from 'next/link'
import { BookOpenIcon, RadioTowerIcon } from 'lucide-react'
import { formatPrice } from '@/lib/format'
import { format } from 'date-fns'
import { IconBadge } from './icon-badge'
import { CourseProgress } from './course-progress'
import { Badge } from '@/components/ui/badge'

type CourseCardProps = {
  id: string
  title: string
  imageUrl: string
  chaptersLength: number
  price: number
  progress: number | null
  category: string
  courseType: 'RECORDED' | 'LIVE'
  schedules?: { scheduledDate: string | Date }[]
}

export default function CourseCard({
  id,
  title,
  imageUrl,
  chaptersLength,
  price,
  progress,
  category,
  courseType,
  schedules,
}: CourseCardProps) {
  return (
    <Link href={`/courses/${id}`}>
      <div className="group h-full overflow-hidden rounded-lg border p-3 transition hover:shadow-sm">
        <div className="relative aspect-video w-full overflow-hidden rounded-md">
          <Image fill className="object-cover" alt={title} src={imageUrl} />
        </div>

        <div className="flex flex-col pt-2">
          <div className="line-clamp-2 text-lg font-medium transition group-hover:text-primary md:text-base">
            {title}
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">{category}</p>
            <Badge variant={courseType === 'LIVE' ? 'destructive' : 'recorded'} className="flex items-center gap-1">
              {courseType === 'LIVE' ? <RadioTowerIcon className="h-3 w-3" /> : null}
              {courseType}
            </Badge>
          </div>
          <div className="my-3 flex items-center gap-x-1 text-sm md:text-xs">
            <div className="flex items-center gap-x-1 text-slate-500">
              <IconBadge size="sm" icon={BookOpenIcon} />
              <span>
                {chaptersLength} {chaptersLength === 1 ? 'Chapter' : 'Chapters'}
              </span>
            </div>
          </div>

          {courseType === 'LIVE' && schedules && schedules.length > 0 ? (
            <p className="text-md font-medium text-slate-700 md:text-sm">
              Next class: {format(
                typeof schedules[0].scheduledDate === 'string' 
                  ? new Date(schedules[0].scheduledDate) 
                  : schedules[0].scheduledDate, 
                "MMM d, yyyy 'at' h:mm a"
              )}
            </p>
          ) : courseType === 'RECORDED' && progress !== null ? (
            <CourseProgress variant={progress === 100 ? 'success' : 'default'} size="sm" value={progress} />
          ) : (
            <p className="text-md font-medium text-slate-700 md:text-sm">{formatPrice(price)}</p>
          )}
        </div>
      </div>
    </Link>
  )
}
