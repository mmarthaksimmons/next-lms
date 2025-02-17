import { auth } from '@clerk/nextjs'
import { NextResponse } from 'next/server'
import { RtcRole, RtcTokenBuilder } from 'agora-access-token'
import { db } from '@/lib/db'

const AGORA_APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID || ''
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || ''

if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
  throw new Error('Agora credentials not configured in environment variables')
}

type CourseWithPurchases = {
  id: string;
  createdById: string;
  agoraChannelName: string | null;
  maxParticipants: number | null;
  isCourseLive: boolean;
  courseType: 'RECORDED' | 'LIVE';
  purchases: Array<{ id: string; userId: string }>;
};

interface LiveSessionRequest {
  maxParticipants?: number;
  nextLiveDate?: string;
}

export async function POST(
  req: Request,
  { params }: { params: { courseId: string } }
) {
  try {
    const { userId } = auth()
    const { courseId } = params
    let maxParticipants: number | undefined
    let nextLiveDate: string | undefined

    if (!userId) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    try {
      // Try to parse request body if it exists
      const body = await req.text()
      if (body) {
        const data: LiveSessionRequest = JSON.parse(body)
        maxParticipants = data.maxParticipants
        nextLiveDate = data.nextLiveDate
      }
    } catch (error) {
      console.error('Failed to parse request body:', error)
      // Continue without body data
    }

    console.log('Finding course:', courseId)
    const course = await db.course.findFirst({
      where: {
        id: courseId,
      },
      include: {
        purchases: {
          select: {
            id: true,
            userId: true
          }
        },
        schedules: {
          where: {
            scheduledDate: {
              gte: new Date(Date.now() - 1000 * 60 * 10), // Within last 10 minutes
              lte: new Date(Date.now() + 1000 * 60 * 60 * 2) // Up to 2 hours from now
            }
          },
          orderBy: {
            scheduledDate: 'asc'
          },
          take: 1
        }
      }
    }) as unknown as (CourseWithPurchases & { schedules: Array<{ scheduledDate: Date }> }) | null

    if (!course) {
      console.error('Course not found')
      return new NextResponse('Course not found', { status: 404 })
    }

    const isTeacher = course.createdById === userId
    const hasPurchased = course.purchases.some(purchase => purchase.userId === userId)

    // Verify access rights
    if (!isTeacher && !hasPurchased) {
      console.error('User does not have access:', {
        userId,
        courseId,
        isTeacher,
        hasPurchased
      })
      return new NextResponse('Unauthorized access to course', { status: 401 })
    }

    // Validate course type
    if (course.courseType !== 'LIVE') {
      console.error('Not a live course:', {
        courseId,
        courseType: course.courseType
      })
      return new NextResponse('This course does not support live sessions', { status: 400 })
    }

    // Teacher-specific validations
    if (isTeacher) {
      // Check if a live session is already in progress
      const existingLiveSession = await db.course.findFirst({
        where: {
          id: courseId,
          isLiveActive: true
        }
      })

      if (existingLiveSession) {
        return new NextResponse('Live session already in progress', { status: 400 })
      }

      if (!course.schedules?.[0]) {
        console.error('No upcoming schedule found within time window')
        return new NextResponse('Cannot start live session - no upcoming schedule found', { status: 400 })
      }

      const scheduleDate = new Date(course.schedules[0].scheduledDate)
      const now = new Date()
      const isWithin10Minutes = now.getTime() >= scheduleDate.getTime() - 1000 * 60 * 10

      if (!isWithin10Minutes) {
        console.error('Too early to start session', {
          now: now.toISOString(),
          scheduleDate: scheduleDate.toISOString()
        })
        return new NextResponse('Cannot start live session yet - available 10 minutes before scheduled time', { status: 400 })
      }
    } else {
      // Student-specific validations
      // Check if there's an active session to join
      const activeLiveSession = await db.course.findFirst({
        where: {
          id: courseId,
          isLiveActive: true
        }
      })

      if (!activeLiveSession) {
        return new NextResponse('No active live session to join', { status: 400 })
      }
    }

    // Check participant limit for non-teacher users
    if (!isTeacher && course.maxParticipants) {
      const participantCount = course.purchases.length
      if (participantCount >= course.maxParticipants) {
        return new NextResponse('Maximum participants limit reached', { status: 403 })
      }
    }

    // Generate channel name if not exists
    let channelName = course.agoraChannelName
    if (!channelName) {
      channelName = `course_${courseId}_${Date.now()}`
      const updateData = {
        agoraChannelName: channelName
      } as const

      if (maxParticipants !== undefined) {
        (updateData as any).maxParticipants = maxParticipants
      }
      if (nextLiveDate) {
        (updateData as any).nextLiveDate = new Date(nextLiveDate)
      }

      await db.course.update({
        where: { id: courseId },
        data: updateData
      })
    }

    // Generate Agora token
    const role = isTeacher ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER
    const expirationTimeInSeconds = 3600 // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000)
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      0, // uid
      role,
      privilegeExpiredTs
    )

    // Update course with token and live status if teacher
    if (isTeacher) {
      await db.course.update({
        where: { id: courseId },
        data: {
          agoraToken: token,
          isLiveActive: true
        }
      })
    }

    return NextResponse.json({
      token,
      channelName,
      appId: AGORA_APP_ID,
      uid: 0,
    })
  } catch (error: any) {
    console.error('Live session error:', error)
    return new NextResponse(error?.message || 'Internal Error', { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { courseId: string } }
) {
  try {
    const { userId } = auth()
    const { courseId } = params

    if (!userId) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const course = await db.course.findUnique({
      where: {
        id: courseId,
        createdById: userId,
      },
    })

    if (!course) {
      return new NextResponse('Course not found or unauthorized', { status: 404 })
    }

    // End live session
    await db.course.update({
      where: { id: courseId },
      data: {
        isLiveActive: false,
        agoraToken: null
      }
    })

    return NextResponse.json({
      message: 'Live session ended successfully'
    })
  } catch (error: any) {
    console.error('End session error:', error)
    return new NextResponse(error?.message || 'Internal Error', { status: 500 })
  }
}
