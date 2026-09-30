import { Module } from '@nestjs/common';
import { HealthModule } from '@super-app/nest';

@Module({
  imports: [HealthModule.forRoot()],
})
export class AppModule {}
