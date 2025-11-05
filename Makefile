NAME = ft_transcendence

all:
	docker compose build
	docker compose up -d

clean:
	docker compose down

fclean: clean
	docker system prune -af --volumes

re: fclean all

.PHONY: all clean fclean re