import { db } from '@/lib/db'
import { CourseWithProgressAndCategory } from './get-courses'
import { getProgress } from './get-progress'
import { clerkClient } from '@clerk/nextjs'

export async function getUpcomingLiveCourses(userId: string): Promise<CourseWithProgressAndCategory[]> {
  try {
    const now = new Date()
    
    const courses = await db.course.findMany({
      where: {
        purchases: {
          some: {
            userId: userId
          }
        },
        courseType: 'LIVE'
      },
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        price: true,
        isPublished: true,
        courseType: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        category: true,
        chapters: true,
        schedules: {
          select: { 
            id: true,
            scheduledDate: true 
          }
        }
      }
    })

    const coursesWithProgress: CourseWithProgressAndCategory[] = await Promise.all(
      courses.map(async (course: typeof courses[0]) => {
        let progressPercentage;
        let teacher;
        
        try {
          [progressPercentage, teacher] = await Promise.all([
            getProgress(userId, course.id),
            clerkClient.users.getUser(course.createdById)
          ]);
        } catch (error) {
          console.error(`Error fetching data for course ${course.id}:`, error);
          progressPercentage = null;
          teacher = null;
        }

        return {
          ...course,
          progress: progressPercentage,
          teacher: {
            name: teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Unknown Teacher',
            image: teacher?.imageUrl || '/placeholder-avatar.png'
          }
        }
      })
    )

    return coursesWithProgress
  } catch (error) {
    console.error('Error fetching upcoming live courses:', error)
    return []
  }
}
